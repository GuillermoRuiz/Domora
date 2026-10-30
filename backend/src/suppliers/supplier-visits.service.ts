import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, SupplierVisitStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { IssueWorkflowService } from '../issue-workflow/issue-workflow.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CloseSupplierVisitDto,
  CreateSupplierVisitDto,
  UpdateSupplierVisitDto,
} from './dto/supplier-visit.dto';

const VISIT_INCLUDE = {
  asset: { select: { id: true, name: true } },
  issue: { select: { id: true, ref: true, title: true } },
} satisfies Prisma.SupplierVisitInclude;

/**
 * Visitas de un proveedor a la finca. Solo la gestión las maneja (el
 * controlador es A/B). Una visita planificada se puede editar, completar o
 * cancelar; una cerrada (realizada o cancelada) ya no cambia: queda como
 * histórico de las "últimas intervenciones".
 */
@Injectable()
export class SupplierVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    /** Una visita ligada a una incidencia se cierra por el workflow (tarea, historial, siguiente paso). Sin él (pruebas), directa. */
    @Optional() private readonly workflow?: IssueWorkflowService,
  ) {}

  private async assertSupplier(estateId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { estateId: true, status: true },
    });
    if (!supplier || supplier.estateId !== estateId) {
      throw new NotFoundException('Proveedor no encontrado en esta finca.');
    }
    return supplier;
  }

  /** La instalación y la incidencia, si se indican, tienen que ser de la misma finca. */
  private async assertLinks(estateId: string, assetId?: string | null, issueId?: string | null) {
    if (assetId) {
      const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { estateId: true } });
      if (!asset || asset.estateId !== estateId) {
        throw new BadRequestException('La instalación no pertenece a esta finca.');
      }
    }
    if (issueId) {
      // Una incidencia borrada (soft delete) ya no se puede vincular.
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, deletedAt: null },
        select: { estateId: true },
      });
      if (!issue || issue.estateId !== estateId) {
        throw new BadRequestException('La incidencia no pertenece a esta finca.');
      }
    }
  }

  private async getVisit(estateId: string, supplierId: string, visitId: string) {
    const visit = await this.prisma.supplierVisit.findUnique({ where: { id: visitId } });
    if (!visit || visit.supplierId !== supplierId || visit.estateId !== estateId) {
      throw new NotFoundException('Visita no encontrada para este proveedor.');
    }
    return visit;
  }

  private assertPlanned(status: SupplierVisitStatus) {
    if (status !== 'planificada') {
      throw new BadRequestException('Solo se puede modificar una visita planificada.');
    }
  }

  /** Más recientes primero. */
  async list(estateId: string, supplierId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplier(estateId, supplierId);
    return this.prisma.supplierVisit.findMany({
      where: { supplierId, estateId },
      orderBy: { scheduledAt: 'desc' },
      include: VISIT_INCLUDE,
    });
  }

  async create(estateId: string, supplierId: string, dto: CreateSupplierVisitDto, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const supplier = await this.assertSupplier(estateId, supplierId);
    if (supplier.status !== 'Activo') {
      throw new BadRequestException('No se puede programar una visita a un proveedor de baja.');
    }
    await this.assertLinks(estateId, dto.assetId, dto.issueId);
    const args = {
      data: {
        supplierId,
        estateId,
        scheduledAt: new Date(dto.scheduledAt),
        purpose: dto.purpose,
        notes: dto.notes,
        assetId: dto.assetId,
        issueId: dto.issueId,
      },
      include: VISIT_INCLUDE,
    };
    // Una visita ligada a una incidencia solo nace si la incidencia sigue activa, comprobado bajo su bloqueo (cerrarla y crear la visita
    // no pueden cruzarse). Sin incidencia, no hay nada que comprobar.
    const issueId = dto.issueId;
    const workflow = this.workflow;
    if (issueId && workflow)
      return this.prisma.$transaction(async (tx) => {
        await workflow.assertAcceptsNewVisit(tx, issueId);
        return tx.supplierVisit.create(args);
      });
    return this.prisma.supplierVisit.create(args);
  }

  async update(
    estateId: string,
    supplierId: string,
    visitId: string,
    dto: UpdateSupplierVisitDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplier(estateId, supplierId);
    const visit = await this.getVisit(estateId, supplierId, visitId);
    this.assertPlanned(visit.status);
    // Solo se comprueban los vínculos que cambian: reenviar la incidencia ya vinculada (que pudo borrarse después)
    // no debe impedir editar la fecha o las notas.
    await this.assertLinks(
      estateId,
      dto.assetId === visit.assetId ? undefined : dto.assetId,
      dto.issueId === visit.issueId ? undefined : dto.issueId,
    );
    // Cambiar la hora de una visita ligada a una incidencia es una operación del workflow (cerrojo, evento y aviso al solicitante), la
    // misma que usa la propia incidencia; el resto de campos se edita como siempre.
    const newTime =
      dto.scheduledAt !== undefined ? new Date(dto.scheduledAt) : undefined;
    // Vincular la visita a OTRA incidencia equivale a crearla en ella: solo si sigue activa (y bajo su bloqueo).
    const linking =
      dto.issueId && dto.issueId !== visit.issueId ? dto.issueId : null;
    if (
      this.workflow &&
      visit.issueId &&
      newTime &&
      newTime.getTime() !== visit.scheduledAt.getTime()
    ) {
      const workflow = this.workflow;
      const issueId = visit.issueId;
      const moved = await this.prisma.$transaction(async (tx) => {
        if (linking) await workflow.assertAcceptsNewVisit(tx, linking);
        const result = await workflow.rescheduleVisit(tx, {
          issueId,
          visitId,
          scheduledAt: newTime,
          actor: { kind: 'person', userId: user.id },
        });
        await tx.supplierVisit.update({
          where: { id: visitId },
          data: {
            ...(dto.purpose !== undefined && { purpose: dto.purpose }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.assetId !== undefined && { assetId: dto.assetId }),
            ...(dto.issueId !== undefined && { issueId: dto.issueId }),
          },
        });
        return result;
      });
      await workflow.afterCommit(moved.requester);
      return this.prisma.supplierVisit.findUniqueOrThrow({
        where: { id: visitId },
        include: VISIT_INCLUDE,
      });
    }
    const args = {
      where: { id: visitId },
      data: {
        ...(dto.scheduledAt !== undefined && { scheduledAt: new Date(dto.scheduledAt) }),
        ...(dto.purpose !== undefined && { purpose: dto.purpose }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.assetId !== undefined && { assetId: dto.assetId }),
        ...(dto.issueId !== undefined && { issueId: dto.issueId }),
      },
      include: VISIT_INCLUDE,
    };
    const workflow = this.workflow;
    if (linking && workflow)
      return this.prisma.$transaction(async (tx) => {
        await workflow.assertAcceptsNewVisit(tx, linking);
        return tx.supplierVisit.update(args);
      });
    return this.prisma.supplierVisit.update(args);
  }

  /** Marca la visita como realizada (también vale una futura: se adelantó). */
  complete(estateId: string, supplierId: string, visitId: string, dto: CloseSupplierVisitDto, user: AuthenticatedUser) {
    return this.close(estateId, supplierId, visitId, 'realizada', dto, user);
  }

  cancel(estateId: string, supplierId: string, visitId: string, dto: CloseSupplierVisitDto, user: AuthenticatedUser) {
    return this.close(estateId, supplierId, visitId, 'cancelada', dto, user);
  }

  private async close(
    estateId: string,
    supplierId: string,
    visitId: string,
    status: 'realizada' | 'cancelada',
    dto: CloseSupplierVisitDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplier(estateId, supplierId);
    const visit = await this.getVisit(estateId, supplierId, visitId);
    this.assertPlanned(visit.status);
    if (visit.issueId && this.workflow) {
      const issueId = visit.issueId;
      const workflow = this.workflow;
      const outcome = await this.prisma.$transaction((tx) =>
        workflow.recordVisitOutcome(tx, {
          issueId,
          visitId,
          outcome: status === 'realizada' ? 'completed' : 'cancelled',
          notes: dto.notes,
          actor: { kind: 'person', userId: user.id },
        }),
      );
      if (outcome.followUp) await workflow.notifyTaskOpened(outcome.followUp);
      return this.prisma.supplierVisit.findUniqueOrThrow({
        where: { id: visitId },
        include: VISIT_INCLUDE,
      });
    }
    const notes = [visit.notes, dto.notes].filter((n): n is string => !!n?.trim()).join('\n');
    const now = new Date();
    return this.prisma.supplierVisit.update({
      where: { id: visitId },
      data: {
        status,
        notes: notes || null,
        ...(status === 'realizada' ? { completedAt: now } : { cancelledAt: now }),
      },
      include: VISIT_INCLUDE,
    });
  }
}
