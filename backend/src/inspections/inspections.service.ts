import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type RegulatoryInspectionStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateInspectionDto } from './dto/create-inspection.dto';
import type { UpdateInspectionDto } from './dto/update-inspection.dto';
import type { CreateInspectionResultDto } from './dto/create-inspection-result.dto';
import type { CreateCorrectiveActionDto } from './dto/create-corrective-action.dto';
import type { UpdateCorrectiveActionDto } from './dto/update-corrective-action.dto';

import { dateOrNull } from '../common/date-or-null';
import { OWNER_ALERTS_LINK } from '../common/owner-links';

const DETAIL_INCLUDE = {
  asset: true,
  inspectionType: true,
  results: { orderBy: { date: 'desc' as const } },
  correctiveActions: { orderBy: { createdAt: 'desc' as const } },
};

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertInspectionAccess(id: string, user: AuthenticatedUser) {
    const inspection = await this.prisma.regulatoryInspection.findUnique({
      where: { id },
    });
    if (!inspection) {
      throw new NotFoundException(`Inspección ${id} no encontrada.`);
    }
    this.estateAccess.assertAccess(inspection.estateId, user);
    return inspection;
  }

  /** Resuelve la inspección propietaria de una acción correctiva y comprueba acceso — la acción no tiene estateId propio. */
  private async assertCorrectiveActionAccess(
    actionId: string,
    user: AuthenticatedUser,
  ) {
    const action = await this.prisma.correctiveAction.findUnique({
      where: { id: actionId },
      include: { inspection: { select: { estateId: true } } },
    });
    if (!action) {
      throw new NotFoundException(`Acción correctiva ${actionId} no encontrada.`);
    }
    this.estateAccess.assertAccess(action.inspection.estateId, user);
    return action;
  }

  async listByEstate(
    estateId: string,
    user: AuthenticatedUser,
    filters: { status?: string; search?: string } = {},
  ) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.regulatoryInspection.findMany({
      where: {
        estateId,
        ...(filters.status
          ? { status: filters.status as RegulatoryInspectionStatus }
          : {}),
        ...(filters.search
          ? {
              OR: [
                { asset: { name: { contains: filters.search, mode: 'insensitive' } } },
                { inspectionType: { name: { contains: filters.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { asset: true, inspectionType: true },
      orderBy: [{ nextDueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string, user: AuthenticatedUser) {
    await this.assertInspectionAccess(id, user);
    return this.prisma.regulatoryInspection.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
  }

  async create(
    estateId: string,
    dto: CreateInspectionDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, estateId },
    });
    if (!asset) {
      throw new NotFoundException(
        `Activo ${dto.assetId} no encontrado en esta finca.`,
      );
    }
    // Igual que el activo: sin esto, una finca podría referenciar el
    // catálogo personalizado de OTRA finca (InspectionType.estateId no NULL
    // pero distinto de esta finca) — el FK por sí solo no comprueba
    // inquilino/tenant, solo que la fila exista.
    const inspectionType = await this.prisma.inspectionType.findFirst({
      where: {
        id: dto.inspectionTypeId,
        OR: [{ estateId: null }, { estateId }],
      },
    });
    if (!inspectionType) {
      throw new NotFoundException(
        `Tipo de inspección ${dto.inspectionTypeId} no encontrado.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.regulatoryInspection.create({
        data: {
          estateId,
          assetId: dto.assetId,
          inspectionTypeId: dto.inspectionTypeId,
          nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : null,
          reminderDaysBefore: dto.reminderDaysBefore ?? 30,
          notes: dto.notes ?? null,
          createdByUserId: user.id,
        },
        include: DETAIL_INCLUDE,
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'regulatory_inspection',
          subjectId: inspection.id,
          verb: 'created',
          summary: `Inspección programada: ${inspection.inspectionType.name} (${asset.name})`,
          occurredAt: new Date(),
          estateId,
          propertyId: null,
        },
      });
      return inspection;
    });
  }

  /**
   * Al pasar a `citada` con `appointmentDate` confirmada, avisa a
   * inquilinos y propietarios de la finca — es el momento en que la
   * inspección de verdad les afecta (posible corte de servicio, necesidad
   * de acceso). El recordatorio de vencimiento interno de la gestora va
   * aparte, por `InspectionsCronService`.
   */
  async update(id: string, dto: UpdateInspectionDto, user: AuthenticatedUser) {
    const existing = await this.assertInspectionAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede gestionar las inspecciones.',
      );
    }

    const statusChanged = dto.status !== undefined && dto.status !== existing.status;
    // `null` borra la cita: no se recurre a la fecha anterior (solo con `undefined`).
    const appointmentDate = dto.appointmentDate === undefined ? existing.appointmentDate?.toISOString() : dto.appointmentDate;
    const becomingCitada = statusChanged && dto.status === 'citada' && !!appointmentDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.regulatoryInspection.update({
        where: { id },
        data: {
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.nextDueDate !== undefined && { nextDueDate: dateOrNull(dto.nextDueDate) }),
          ...(dto.appointmentDate !== undefined && { appointmentDate: dateOrNull(dto.appointmentDate) }),
          ...(dto.lastDoneDate !== undefined && { lastDoneDate: dateOrNull(dto.lastDoneDate) }),
          ...(dto.reminderDaysBefore !== undefined && { reminderDaysBefore: dto.reminderDaysBefore }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: DETAIL_INCLUDE,
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'regulatory_inspection',
          subjectId: id,
          verb: statusChanged ? 'status_changed' : 'updated',
          summary: statusChanged
            ? `Inspección "${inspection.inspectionType.name}" pasó a estado "${inspection.status}"`
            : `Inspección "${inspection.inspectionType.name}" actualizada`,
          occurredAt: new Date(),
          estateId: inspection.estateId,
          propertyId: null,
        },
      });
      return inspection;
    });

    if (becomingCitada) {
      await this.notifyResidentsOfAppointment(updated);
    }

    return updated;
  }

  private async notifyResidentsOfAppointment(
    inspection: Prisma.RegulatoryInspectionGetPayload<{ include: typeof DETAIL_INCLUDE }>,
  ) {
    const residentIds = await this.notifications.residentIds({
      estateId: inspection.estateId,
    });
    const dateLabel = inspection.appointmentDate!.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    await this.notifications.notify({
      userIds: residentIds,
      category: 'inspection',
      title: `Inspección programada: ${inspection.asset.name}`,
      body: `Se ha programado una inspección de "${inspection.asset.name}" (${inspection.inspectionType.name}) para el ${dateLabel}. Es posible que se necesite acceso o que el servicio quede interrumpido durante la visita.`,
      link: OWNER_ALERTS_LINK,
      estateId: inspection.estateId,
    });
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    await this.assertInspectionAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede eliminar inspecciones.',
      );
    }
    await this.prisma.regulatoryInspection.delete({ where: { id } });
  }

  /**
   * Registrar un resultado también cierra el ciclo: favorable → `realizada`,
   * desfavorable → `desfavorable` (y `lastDoneDate` se fija a la fecha del
   * resultado) — evita que la gestora tenga que actualizar el estado a mano
   * después de subir el certificado.
   */
  async addResult(
    inspectionId: string,
    dto: CreateInspectionResultDto,
    certificateKey: string | null,
    user: AuthenticatedUser,
  ) {
    await this.assertInspectionAccess(inspectionId, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede registrar resultados de inspección.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.inspectionResult.create({
        data: {
          inspectionId,
          date: new Date(dto.date),
          outcome: dto.outcome,
          defects: dto.defects ?? null,
          certificateKey,
          cost: dto.cost ? new Prisma.Decimal(dto.cost) : null,
          notes: dto.notes ?? null,
          createdByUserId: user.id,
        },
      });
      const inspection = await tx.regulatoryInspection.update({
        where: { id: inspectionId },
        data: {
          status: dto.outcome === 'favorable' ? 'realizada' : 'desfavorable',
          lastDoneDate: new Date(dto.date),
        },
        include: DETAIL_INCLUDE,
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'regulatory_inspection',
          subjectId: inspectionId,
          verb: 'status_changed',
          summary: `Resultado registrado (${dto.outcome}) para "${inspection.inspectionType.name}"`,
          occurredAt: new Date(),
          estateId: inspection.estateId,
          propertyId: null,
        },
      });
      return result;
    });
  }

  async getResultCertificate(
    inspectionId: string,
    resultId: string,
    user: AuthenticatedUser,
  ): Promise<Buffer> {
    await this.assertInspectionAccess(inspectionId, user);
    const result = await this.prisma.inspectionResult.findFirst({
      where: { id: resultId, inspectionId },
    });
    if (!result?.certificateKey) {
      throw new NotFoundException('Certificado no encontrado.');
    }
    return this.storage.get(result.certificateKey);
  }

  async addCorrectiveAction(
    inspectionId: string,
    dto: CreateCorrectiveActionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertInspectionAccess(inspectionId, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede abrir acciones correctivas.',
      );
    }
    return this.prisma.correctiveAction.create({
      data: {
        inspectionId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 2,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeUserId: dto.assigneeUserId ?? null,
        supplierId: dto.supplierId ?? null,
      },
    });
  }

  async updateCorrectiveAction(
    actionId: string,
    dto: UpdateCorrectiveActionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCorrectiveActionAccess(actionId, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede gestionar acciones correctivas.',
      );
    }
    return this.prisma.correctiveAction.update({
      where: { id: actionId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.dueDate !== undefined && { dueDate: dateOrNull(dto.dueDate) }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.assigneeUserId !== undefined && { assigneeUserId: dto.assigneeUserId }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
      },
    });
  }
}
