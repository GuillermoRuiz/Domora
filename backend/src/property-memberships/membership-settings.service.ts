import { Injectable, NotFoundException } from '@nestjs/common';
import type { PropertyMembershipSettings } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { UpdateMembershipSettingsDto } from './dto/update-membership-settings.dto';
import {
  MEMBERSHIP_SETTINGS_DEFAULTS,
  MembershipSettingsValues,
} from './membership-settings.defaults';

@Injectable()
export class MembershipSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Descarta los metadatos de fila (id/membershipId/timestamps) — solo los valores de MembershipSettingsValues salen de este servicio. */
  private toValues(
    settings: PropertyMembershipSettings,
  ): MembershipSettingsValues {
    return {
      visibleInDirectory: settings.visibleInDirectory,
      showPhoneInDirectory: settings.showPhoneInDirectory,
      showEmailInDirectory: settings.showEmailInDirectory,
      visibleInBookings: settings.visibleInBookings,
      allowDirectMessages: settings.allowDirectMessages,
      displayNamePolicy: settings.displayNamePolicy,
      displayAlias: settings.displayAlias,
      notifyIssues: settings.notifyIssues,
      notifyReceipts: settings.notifyReceipts,
      notifyCommunications: settings.notifyCommunications,
      notifyBookings: settings.notifyBookings,
      notifyDirectMessages: settings.notifyDirectMessages,
    };
  }

  /**
   * Solo el propio usuario gestiona su privacidad/notificaciones — ni el
   * gestor (A/B) tiene endpoint para leerlas o editarlas. Resuelto por
   * (propertyId, user.id), nunca por membershipId en la URL, para que no
   * se pueda adivinar/consultar la fila de otro usuario.
   */
  private async findMyMembership(propertyId: string, user: AuthenticatedUser) {
    const membership = await this.prisma.propertyMembership.findFirst({
      where: { propertyId, userId: user.id, status: 'linked', revokedAt: null },
    });
    if (!membership) {
      throw new NotFoundException(
        `No tienes una membresía activa en la propiedad ${propertyId}.`,
      );
    }
    return membership;
  }

  async getMine(
    propertyId: string,
    user: AuthenticatedUser,
  ): Promise<MembershipSettingsValues> {
    const membership = await this.findMyMembership(propertyId, user);
    const settings = await this.prisma.propertyMembershipSettings.findUnique({
      where: { membershipId: membership.id },
    });
    if (!settings) return { ...MEMBERSHIP_SETTINGS_DEFAULTS };
    return this.toValues(settings);
  }

  async updateMine(
    propertyId: string,
    user: AuthenticatedUser,
    dto: UpdateMembershipSettingsDto,
  ): Promise<MembershipSettingsValues> {
    const membership = await this.findMyMembership(propertyId, user);
    const settings = await this.prisma.propertyMembershipSettings.upsert({
      where: { membershipId: membership.id },
      update: { ...dto },
      create: {
        membershipId: membership.id,
        ...MEMBERSHIP_SETTINGS_DEFAULTS,
        ...dto,
      },
    });
    return this.toValues(settings);
  }
}
