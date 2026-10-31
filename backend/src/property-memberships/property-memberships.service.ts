import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MEMBERSHIP_SETTINGS_DEFAULTS } from './membership-settings.defaults';
import { USER_SECRETS_OMIT } from '../common/secret-omit';

@Injectable()
export class PropertyMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  private async assertPropertyAccess(
    propertyId: string,
    user: AuthenticatedUser,
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    this.estateAccess.assertAccess(property.estateId, user);
  }

  /**
   * Directorio de vecinos, con privacidad por membresía aplicada
   * (`PropertyMembershipSettings.visibleInDirectory`/`showPhoneInDirectory`/
   * `showEmailInDirectory`). Un rol A/B, o el propio usuario viendo su
   * propia fila, siempre ve el dato completo — la privacidad es frente a
   * OTROS vecinos, no frente al gestor ni frente a uno mismo.
   */
  async listByProperty(propertyId: string, user: AuthenticatedUser) {
    await this.assertPropertyAccess(propertyId, user);
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { propertyId, revokedAt: null },
      include: { user: { omit: USER_SECRETS_OMIT }, settings: true },
    });

    const isPrivileged = (m: { userId: string }) =>
      user.role !== 'C' || m.userId === user.id;

    return memberships
      .filter((m) => {
        const visible =
          m.settings?.visibleInDirectory ??
          MEMBERSHIP_SETTINGS_DEFAULTS.visibleInDirectory;
        return visible || isPrivileged(m);
      })
      .map(({ settings, ...m }) => {
        if (isPrivileged(m)) return m;
        const showPhone =
          settings?.showPhoneInDirectory ??
          MEMBERSHIP_SETTINGS_DEFAULTS.showPhoneInDirectory;
        const showEmail =
          settings?.showEmailInDirectory ??
          MEMBERSHIP_SETTINGS_DEFAULTS.showEmailInDirectory;
        return {
          ...m,
          user: {
            ...m.user,
            phone: showPhone ? m.user.phone : null,
            email: showEmail ? m.user.email : null,
            // El NIF/NIE de otro vecino no es para nadie más que la gestión y él mismo.
            taxId: null,
            taxIdCountry: null,
          },
        };
      });
  }

  /**
   * Sin scoping por finca: un usuario siempre puede ver sus propias
   * membresías (rol C consultando "mis propiedades"); un rol A/B consultando
   * las de otro usuario queda acotado a lo que ya sea visible vía
   * scopedWhere de la propiedad — se filtra tras la consulta porque
   * PropertyMembership no tiene `estateId` propio.
   */
  async listByUser(userId: string, user: AuthenticatedUser) {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { userId, revokedAt: null },
      include: { property: true },
    });
    if (user.role === 'A' || user.id === userId) {
      return memberships;
    }
    return memberships.filter((m) =>
      this.estateAccess.canAccess(m.property.estateId, user),
    );
  }

  async findPrimaryContact(propertyId: string, user: AuthenticatedUser) {
    await this.assertPropertyAccess(propertyId, user);
    return this.prisma.propertyMembership.findFirst({
      where: { propertyId, isPrimaryContact: true, revokedAt: null },
      include: { user: { omit: USER_SECRETS_OMIT } },
    });
  }

  /**
   * Primary contact activo de la propiedad, o rol A/B con acceso a su
   * finca — criterio compartido por `revoke()` y por
   * `PropertyMembershipInvitesService.createInvite()`.
   */
  async assertCanManageMembers(propertyId: string, user: AuthenticatedUser) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    if (
      user.role === 'A' ||
      (user.role === 'B' &&
        this.estateAccess.canAccess(property.estateId, user))
    ) {
      return property;
    }
    const isPrimaryContact = await this.prisma.propertyMembership.findFirst({
      where: {
        propertyId,
        userId: user.id,
        isPrimaryContact: true,
        revokedAt: null,
      },
    });
    if (!isPrimaryContact) {
      throw new ForbiddenException(
        'No tienes permiso para gestionar los miembros de esta propiedad.',
      );
    }
    return property;
  }

  /**
   * Baja puntual de una membresía ya `linked` — a diferencia de
   * `AdhesionRequestsService.reject()` (que solo revoca la membresía de una
   * solicitud pendiente), esta acción la puede disparar el primary contact
   * de la propiedad o un rol A/B como respaldo administrativo, sobre
   * cualquier membresía ya vinculada.
   *
   * Dos salvaguardas para no dejar una propiedad huérfana: nunca se puede
   * revocar la última membresía `linked` que queda, y revocar al único
   * primary contact activo exige indicar a quién promover en su lugar
   * (`promoteMembershipId`) — nunca queda una propiedad sin titular.
   */
  async revoke(
    propertyId: string,
    membershipId: string,
    user: AuthenticatedUser,
    promoteMembershipId?: string,
  ) {
    const property = await this.assertCanManageMembers(propertyId, user);

    const membership = await this.prisma.propertyMembership.findFirst({
      where: { id: membershipId, propertyId, revokedAt: null },
    });
    if (!membership) {
      throw new NotFoundException(
        `Membresía ${membershipId} no encontrada en la propiedad ${propertyId}.`,
      );
    }

    const linkedCount = await this.prisma.propertyMembership.count({
      where: { propertyId, status: 'linked', revokedAt: null },
    });
    if (linkedCount <= 1) {
      throw new ConflictException(
        'No se puede revocar el único miembro vinculado de la propiedad.',
      );
    }

    if (membership.isPrimaryContact) {
      if (!promoteMembershipId) {
        throw new ConflictException(
          'Este miembro es el titular principal — indica a quién promover (promoteMembershipId) antes de revocarlo.',
        );
      }
      const promotee = await this.prisma.propertyMembership.findFirst({
        where: {
          id: promoteMembershipId,
          propertyId,
          status: 'linked',
          revokedAt: null,
        },
      });
      if (!promotee) {
        throw new NotFoundException(
          `La membresía a promover ${promoteMembershipId} no existe o no está vinculada a esta propiedad.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (promoteMembershipId) {
        await tx.propertyMembership.update({
          where: { id: promoteMembershipId },
          data: { isPrimaryContact: true },
        });
      }
      const revoked = await tx.propertyMembership.update({
        where: { id: membershipId },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          isPrimaryContact: false,
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'membership',
          subjectId: revoked.id,
          verb: 'status_changed',
          summary: `Membresía de tipo ${revoked.roleType} revocada`,
          occurredAt: new Date(),
          estateId: property.estateId,
          propertyId,
        },
      });
      return revoked;
    });
  }
}
