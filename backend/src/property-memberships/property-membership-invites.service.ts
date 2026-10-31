import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyMembershipsService } from './property-memberships.service';
import { MailService } from '../mail/mail.service';
import { resolveFrontendBaseUrl } from '../common/frontend-url';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { MembershipRoleType } from '../prisma/client';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, mismo criterio que TeamInvite.

/**
 * Invitación de un miembro (Inquilino/Representante/Ocupante) a una
 * propiedad ya vinculada a una finca — mismo patrón de token opaco de un
 * solo uso que `AuthService.createTeamInvite`/`redeemTeamInvite`, pero sin
 * crear cuenta: `redeemInvite` requiere sesión iniciada y solo adjunta la
 * membresía al usuario autenticado (a diferencia de un team-invite, quien
 * canjea puede ya tener cuenta propia).
 */
@Injectable()
export class PropertyMembershipInvitesService {
  private readonly logger = new Logger(PropertyMembershipInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: PropertyMembershipsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private buildInviteUrl(token: string): string {
    return `${resolveFrontendBaseUrl(this.config)}/membership-invite/${token}`;
  }

  private async propertyLabel(
    propertyId: string,
  ): Promise<{ address: string; estateName: string | null }> {
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      include: { estate: { select: { name: true } } },
    });
    const address = [
      property.viaType,
      property.viaName,
      property.streetNumber,
      property.staircase && `esc. ${property.staircase}`,
      property.floor && `${property.floor}º`,
      property.door,
    ]
      .filter(Boolean)
      .join(' ');
    return { address, estateName: property.estate?.name ?? null };
  }

  async createInvite(
    propertyId: string,
    roleType: MembershipRoleType,
    inviteeEmail: string,
    user: AuthenticatedUser,
  ): Promise<{ token: string; inviteUrl: string; qrDataUrl: string }> {
    await this.memberships.assertCanManageMembers(propertyId, user);
    return this.issueInvite({ propertyId, roleType, inviteeEmail, user });
  }

  /**
   * Invitación de PROPIETARIO para un titular importado sin cuenta. Solo la
   * gestora (o Domora), nunca el titular principal de la propiedad: dar la
   * titularidad es decisión de quien registró el censo. Queda ligada al
   * `ExternalOwner` — al canjearla, ese titular pasa a ser el usuario.
   */
  async createOwnerInvite(
    propertyId: string,
    externalOwnerId: string,
    user: AuthenticatedUser,
  ): Promise<{ token: string; inviteUrl: string; qrDataUrl: string }> {
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo la gestora puede invitar a un propietario.',
      );
    }
    await this.memberships.assertCanManageMembers(propertyId, user);

    const owner = await this.prisma.externalOwner.findFirst({
      where: { id: externalOwnerId, propertyId, promotedToUserId: null },
    });
    if (!owner) {
      throw new NotFoundException(
        'Ese titular no existe en esta propiedad o ya tiene cuenta.',
      );
    }
    if (!owner.email) {
      throw new BadRequestException(
        'El titular no tiene email: añádelo antes de invitarlo.',
      );
    }
    const pending = await this.prisma.propertyMembershipInvite.count({
      where: {
        externalOwnerId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending > 0) {
      throw new ConflictException(
        'Este titular ya tiene una invitación pendiente: reenvíala desde la lista de invitaciones.',
      );
    }

    return this.issueInvite({
      propertyId,
      roleType: 'Propietario',
      inviteeEmail: owner.email,
      externalOwnerId,
      user,
    });
  }

  private async issueInvite(params: {
    propertyId: string;
    roleType: MembershipRoleType;
    inviteeEmail: string;
    externalOwnerId?: string;
    user: AuthenticatedUser;
  }): Promise<{ token: string; inviteUrl: string; qrDataUrl: string }> {
    const { propertyId, roleType, inviteeEmail, externalOwnerId, user } =
      params;
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    await this.prisma.propertyMembershipInvite.create({
      data: {
        propertyId,
        roleType,
        inviteeEmail,
        externalOwnerId: externalOwnerId ?? null,
        tokenHash: this.hashToken(token),
        createdByUserId: user.id,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        lastSentAt: now,
      },
    });

    const inviteUrl = this.buildInviteUrl(token);
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);

    const { address, estateName } = await this.propertyLabel(propertyId);
    this.mail
      .sendMembershipInvite(
        inviteeEmail,
        roleType,
        address,
        estateName,
        inviteUrl,
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `No se pudo enviar la invitación a ${inviteeEmail}: ${String(error)}`,
        ),
      );

    return { token, inviteUrl, qrDataUrl };
  }

  private async findValidInvite(token: string) {
    const invite = await this.prisma.propertyMembershipInvite.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!invite) {
      throw new UnauthorizedException('El enlace de invitación no es válido.');
    }
    if (invite.revokedAt) {
      throw new UnauthorizedException(
        'Este enlace de invitación fue revocado.',
      );
    }
    if (invite.usedAt) {
      throw new ConflictException(
        'Este enlace de invitación ya fue utilizado.',
      );
    }
    if (invite.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace de invitación caducó.');
    }
    return invite;
  }

  async getInviteInfo(token: string): Promise<{
    roleType: MembershipRoleType;
    propertyAddress: string | null;
    estateName: string | null;
  }> {
    const invite = await this.findValidInvite(token);
    const { address, estateName } = await this.propertyLabel(invite.propertyId);
    return {
      roleType: invite.roleType,
      propertyAddress: address || null,
      estateName,
    };
  }

  async redeemInvite(token: string, user: AuthenticatedUser) {
    const invite = await this.findValidInvite(token);

    return this.prisma.$transaction(async (tx) => {
      // Re-chequeado dentro de la transacción — mismo motivo que
      // `AuthService.redeemTeamInvite`: dos canjes concurrentes del mismo
      // enlace deben resolver en que solo uno gane.
      const fresh = await tx.propertyMembershipInvite.findUnique({
        where: { id: invite.id },
      });
      if (fresh?.usedAt) {
        throw new ConflictException(
          'Este enlace de invitación ya fue utilizado.',
        );
      }

      const actor = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          fullName: true,
          email: true,
          taxId: true,
          taxIdCountry: true,
        },
      });

      // Un Propietario vota en juntas, ve deudas y puede invitar: su enlace no
      // puede funcionar como token al portador (un email reenviado o una
      // dirección equivocada del programa anterior entregaría la titularidad
      // a otra persona). Tiene que canjearlo la cuenta de ese email.
      const isOwnerInvite = !!invite.externalOwnerId;
      if (
        isOwnerInvite &&
        actor.email.trim().toLowerCase() !==
          invite.inviteeEmail.trim().toLowerCase()
      ) {
        throw new ForbiddenException(
          `Esta invitación es para ${invite.inviteeEmail}. Inicia sesión con esa cuenta para aceptarla.`,
        );
      }

      const notes: string[] = [];
      let becomesPrimaryContact = false;
      if (isOwnerInvite) {
        const externalOwner = await tx.externalOwner.findUniqueOrThrow({
          where: { id: invite.externalOwnerId! },
        });
        // Condicional atómico: si dos canjes llegaran a la vez, solo uno
        // encuentra `promotedToUserId: null`.
        const promoted = await tx.externalOwner.updateMany({
          where: { id: externalOwner.id, promotedToUserId: null },
          data: { promotedToUserId: user.id, promotedAt: new Date() },
        });
        if (promoted.count !== 1) {
          throw new ConflictException(
            'Este titular ya está vinculado a otra cuenta.',
          );
        }

        // El NIF de los recibos sale del usuario una vez promovido: sin
        // copiarlo, los recibos siguientes lo perderían. Nunca se pisa uno ya
        // informado — si difieren, queda anotado para que la gestora lo revise.
        if (externalOwner.taxId && !actor.taxId) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              taxId: externalOwner.taxId,
              taxIdCountry: externalOwner.taxIdCountry,
            },
          });
        } else if (
          externalOwner.taxId &&
          actor.taxId &&
          externalOwner.taxId !== actor.taxId
        ) {
          notes.push(
            `su NIF (${actor.taxId}) no coincide con el importado (${externalOwner.taxId})`,
          );
        }

        const existingPrimary = await tx.propertyMembership.count({
          where: {
            propertyId: invite.propertyId,
            isPrimaryContact: true,
            status: 'linked',
            revokedAt: null,
          },
        });
        becomesPrimaryContact = existingPrimary === 0;
      }

      const membership = await tx.propertyMembership.upsert({
        where: {
          propertyId_userId_roleType: {
            propertyId: invite.propertyId,
            userId: user.id,
            roleType: invite.roleType,
          },
        },
        update: {
          status: 'linked',
          revokedAt: null,
          approvedByUserId: invite.createdByUserId,
          ...(becomesPrimaryContact ? { isPrimaryContact: true } : {}),
        },
        create: {
          propertyId: invite.propertyId,
          userId: user.id,
          roleType: invite.roleType,
          status: 'linked',
          isPrimaryContact: becomesPrimaryContact,
          linkedAt: new Date(),
          approvedByUserId: invite.createdByUserId,
        },
      });

      await tx.propertyMembershipInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByUserId: user.id },
      });

      const property = await tx.property.findUniqueOrThrow({
        where: { id: invite.propertyId },
        select: { estateId: true },
      });
      const summary = [
        `${actor.fullName ?? 'Un usuario'} se vinculó a la propiedad como ${invite.roleType}`,
        ...(isOwnerInvite ? ['(titular importado)'] : []),
        ...(notes.length > 0 ? [`— ${notes.join('; ')}`] : []),
      ].join(' ');
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'membership',
          subjectId: membership.id,
          verb: 'status_changed',
          summary,
          occurredAt: new Date(),
          estateId: property.estateId,
          propertyId: invite.propertyId,
        },
      });

      return membership;
    });
  }

  /** Ventana para avisar de que una invitación está por caducar — misma idea que el recordatorio de acta (art. 19 LPH), sin base legal aquí, es solo UX. */
  private static readonly EXPIRING_SOON_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

  /**
   * Estado derivado al leer, nunca persistido — mismo criterio que
   * `MeetingQuorumService`: una invitación no guarda su propio estado, se
   * calcula a partir de `usedAt`/`revokedAt`/`expiresAt`.
   */
  private deriveInviteStatus(invite: {
    usedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): 'pending' | 'expiring_soon' | 'expired' | 'revoked' {
    if (invite.revokedAt) return 'revoked';
    const now = Date.now();
    if (invite.expiresAt.getTime() < now) return 'expired';
    if (
      invite.expiresAt.getTime() - now <=
      PropertyMembershipInvitesService.EXPIRING_SOON_WINDOW_MS
    ) {
      return 'expiring_soon';
    }
    return 'pending';
  }

  /** Invitaciones aún no canjeadas de una propiedad — una vez canjeada, la invitación se vuelve un `PropertyMembership` y desaparece de este listado. */
  async listPendingInvites(propertyId: string, user: AuthenticatedUser) {
    await this.memberships.assertCanManageMembers(propertyId, user);
    const invites = await this.prisma.propertyMembershipInvite.findMany({
      where: { propertyId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((invite) => ({
      id: invite.id,
      roleType: invite.roleType,
      inviteeEmail: invite.inviteeEmail,
      externalOwnerId: invite.externalOwnerId,
      status: this.deriveInviteStatus(invite),
      expiresAt: invite.expiresAt,
      lastSentAt: invite.lastSentAt,
      createdAt: invite.createdAt,
    }));
  }

  private async assertOutstandingInvite(propertyId: string, inviteId: string) {
    const invite = await this.prisma.propertyMembershipInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite || invite.propertyId !== propertyId) {
      throw new UnauthorizedException('La invitación no existe.');
    }
    if (invite.usedAt) {
      throw new ConflictException('Esta invitación ya fue canjeada.');
    }
    if (invite.revokedAt) {
      throw new ConflictException('Esta invitación ya fue revocada.');
    }
    return invite;
  }

  /** Extiende la caducidad y reenvía — mantiene el MISMO token para no romper un enlace que la gestora ya haya reenviado a mano (WhatsApp, etc.). */
  async resendInvite(
    propertyId: string,
    inviteId: string,
    user: AuthenticatedUser,
  ) {
    await this.memberships.assertCanManageMembers(propertyId, user);
    const invite = await this.assertOutstandingInvite(propertyId, inviteId);

    // El token en claro nunca se persiste (solo su hash) — reenviar el MISMO
    // enlace es imposible por diseño. En su lugar se genera uno nuevo para
    // la misma fila (mismo `inviteId`, a diferencia de `createInvite`, que
    // crea una fila nueva) e invalida el anterior — más seguro que dejar
    // circulando dos enlaces válidos para la misma invitación.
    const now = new Date();
    const token = crypto.randomBytes(32).toString('hex');
    const updated = await this.prisma.propertyMembershipInvite.update({
      where: { id: invite.id },
      data: {
        tokenHash: this.hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        lastSentAt: now,
      },
    });

    const inviteUrl = this.buildInviteUrl(token);
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);
    const { address, estateName } = await this.propertyLabel(propertyId);
    this.mail
      .sendMembershipInvite(
        updated.inviteeEmail,
        updated.roleType,
        address,
        estateName,
        inviteUrl,
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `No se pudo reenviar la invitación a ${updated.inviteeEmail}: ${String(error)}`,
        ),
      );

    return { inviteUrl, qrDataUrl };
  }

  async revokeInvite(
    propertyId: string,
    inviteId: string,
    user: AuthenticatedUser,
  ) {
    await this.memberships.assertCanManageMembers(propertyId, user);
    const invite = await this.assertOutstandingInvite(propertyId, inviteId);
    return this.prisma.propertyMembershipInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date(), revokedByUserId: user.id },
    });
  }
}
