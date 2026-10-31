import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { USER_SECRETS_OMIT } from '../common/secret-omit';
import { OWNER_HOME_LINK, ownerPropertyLink } from '../common/owner-links';

@Injectable()
export class AdhesionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.adhesionRequest.findMany({
      where: { estateId },
      include: { user: { omit: USER_SECRETS_OMIT }, property: true },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /**
   * Todas las solicitudes pendientes de TODAS las fincas a las que el
   * usuario tiene acceso (dashboard "Solicitudes" del rol B) — a diferencia
   * de `listPendingByEstate`, no requiere navegar finca por finca. Incluye
   * la finca embebida para que la tarjeta muestre a qué comunidad pertenece
   * sin una consulta adicional por fila.
   */
  async listAllPending(user: AuthenticatedUser) {
    return this.prisma.adhesionRequest.findMany({
      where: { ...this.estateAccess.scopedWhere(user), status: 'pending' },
      include: {
        user: { omit: USER_SECRETS_OMIT },
        property: true,
        estate: {
          select: {
            id: true,
            name: true,
            type: true,
            address: true,
            location: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async listPendingByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.adhesionRequest.findMany({
      where: { estateId, status: 'pending' },
      include: { user: { omit: USER_SECRETS_OMIT }, property: true },
      orderBy: { submittedAt: 'desc' },
    });
  }

  private async findPendingOrThrow(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.adhesionRequest.findFirst({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException(`Solicitud de adhesión ${id} no encontrada.`);
    }
    this.estateAccess.assertAccess(request.estateId, user);
    if (request.status !== 'pending') {
      throw new ConflictException(`La solicitud ${id} ya fue resuelta.`);
    }
    return request;
  }

  /**
   * Aprobar da de alta (o reactiva) la `PropertyMembership` real —
   * `AdhesionRequest` es solo metadata de quién solicitó/resolvió; el
   * vínculo vive en `property_memberships` (pending → linked). Ambas
   * escrituras ocurren en una única transacción, igual que
   * `DataService.approveAdhesion`.
   */
  async approve(id: string, user: AuthenticatedUser) {
    const request = await this.findPendingOrThrow(id, user);
    if (!request.propertyId) {
      throw new ConflictException(
        `La solicitud ${id} no está vinculada a ninguna propiedad concreta.`,
      );
    }

    let estateName = '';
    const membership = await this.prisma.$transaction(async (tx) => {
      await tx.adhesionRequest.update({
        where: { id },
        data: {
          status: 'approved',
          decision: 'approved',
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
        },
      });

      // La propiedad de autoservicio (rol C) nace desvinculada (estateId
      // null) — aprobar la adhesión es lo que la vincula de verdad a la
      // finca. Sin esto, PropertiesService.listByEstate() (que filtra por
      // property.estateId) nunca la muestra en la pestaña Propiedades del
      // administrador, aunque la membresía ya esté 'linked'.
      const estate = await tx.estate.findUniqueOrThrow({
        where: { id: request.estateId },
        select: { administratorId: true, name: true },
      });
      estateName = estate.name;
      await tx.property.update({
        where: { id: request.propertyId! },
        data: {
          estateId: request.estateId,
          administratorId: estate.administratorId,
        },
      });

      const membership = await tx.propertyMembership.upsert({
        where: {
          propertyId_userId_roleType: {
            propertyId: request.propertyId!,
            userId: request.userId,
            roleType: request.roleType,
          },
        },
        update: {
          status: 'linked',
          revokedAt: null,
          approvedByUserId: user.id,
        },
        create: {
          propertyId: request.propertyId!,
          userId: request.userId,
          roleType: request.roleType,
          status: 'linked',
          isPrimaryContact: false,
          linkedAt: new Date(),
          approvedByUserId: user.id,
        },
      });

      // La adhesión no tiene timeline propio — es el caso para el que
      // existe activity_log (Apéndice H, gap #17). Los dominios con
      // timeline (issues...) NO escriben aquí.
      const requester = await tx.user.findUnique({
        where: { id: request.userId },
        select: { fullName: true },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'membership',
          subjectId: membership.id,
          verb: 'status_changed',
          summary: `Solicitud de adhesión aprobada para ${requester?.fullName ?? request.userId}`,
          occurredAt: new Date(),
          estateId: request.estateId,
          propertyId: request.propertyId,
        },
      });

      return membership;
    });

    await this.notifyRequester(request, true, estateName);
    return membership;
  }

  async reject(id: string, user: AuthenticatedUser, notes?: string) {
    const request = await this.findPendingOrThrow(id, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.adhesionRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          decision: 'rejected',
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
          notes,
        },
      });

      if (request.propertyId) {
        await tx.propertyMembership.updateMany({
          where: {
            propertyId: request.propertyId,
            userId: request.userId,
            roleType: request.roleType,
            status: { not: 'revoked' },
          },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }

      const requester = await tx.user.findUnique({
        where: { id: request.userId },
        select: { fullName: true },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'membership',
          subjectId: request.id,
          verb: 'status_changed',
          summary: `Solicitud de adhesión rechazada para ${requester?.fullName ?? request.userId}`,
          occurredAt: new Date(),
          estateId: request.estateId,
          propertyId: request.propertyId,
        },
      });

      return updated;
    });

    const estate = await this.prisma.estate.findUnique({
      where: { id: request.estateId },
      select: { name: true },
    });
    await this.notifyRequester(request, false, estate?.name ?? '');
    return updated;
  }

  /** Avisa al solicitante (rol C) de la decisión tomada sobre su solicitud. */
  private async notifyRequester(
    request: { userId: string; estateId: string; propertyId: string | null },
    approved: boolean,
    estateName: string,
  ): Promise<void> {
    const where = estateName ? ` de ${estateName}` : '';
    await this.notifications.notify({
      userIds: [request.userId],
      category: 'adhesion',
      title: approved
        ? 'Solicitud de adhesión aprobada'
        : 'Solicitud de adhesión rechazada',
      body: approved
        ? `Ya formas parte de la comunidad${where}.`
        : `La gestora ha rechazado tu solicitud${where}.`,
      // An approved adhesion opens the property (when the request names one); otherwise «Mi comunidad».
      link:
        approved && request.propertyId
          ? ownerPropertyLink(request.propertyId)
          : OWNER_HOME_LINK,
      estateId: request.estateId,
      propertyId: request.propertyId,
    });
  }
}
