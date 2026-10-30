import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DIRECT_MESSAGE_ATTACHMENT_SELECT } from './direct-message-attachment.fields';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { SendDirectMessageDto } from './dto/send-direct-message.dto';
import type { UpdateUserMessagingSettingsDto } from './dto/update-user-messaging-settings.dto';
import { MEMBERSHIP_SETTINGS_DEFAULTS } from '../property-memberships/membership-settings.defaults';
import {
  USER_MESSAGING_SETTINGS_DEFAULTS,
  UserMessagingSettingsValues,
} from './user-messaging-settings.defaults';

/** Lo que se ve en la bandeja cuando el último mensaje de una conversación se ha borrado. */
export const DELETED_MESSAGE_PREVIEW = 'Este mensaje ha sido borrado';

export interface ContactRow {
  userId: string;
  displayName: string;
  estateId: string;
  /** Conversación ya existente con este contacto (también si la eliminó de su lista), para mostrar su historial antes de escribir. */
  conversationId: string | null;
}

@Injectable()
export class DirectMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private formatPropertyAddress(p: {
    floor: string | null;
    door: string | null;
    staircase: string | null;
    ref: string | null;
  }): string {
    const parts: string[] = [];
    if (p.floor) parts.push(`${p.floor}ª planta`);
    if (p.door) parts.push(`Puerta ${p.door}`);
    if (p.staircase) parts.push(`Esc. ${p.staircase}`);
    return parts.join(', ') || (p.ref ?? '');
  }

  /** Cómo se muestra `userId` dentro de la finca `estateId`, según su propia preferencia de privacidad. */
  private async resolveDisplayName(
    userId: string,
    estateId: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, role: true },
    });
    if (!user) return 'Usuario desconocido';

    if (user.role !== 'C') {
      // Rol A/B: sin PropertyMembership, su identidad no está atada a una
      // finca concreta — ajuste global en UserMessagingSettings.
      const settings = await this.prisma.userMessagingSettings.findUnique({
        where: { userId },
      });
      const policy =
        settings?.displayNamePolicy ??
        USER_MESSAGING_SETTINGS_DEFAULTS.displayNamePolicy;
      if (policy === 'alias') {
        return settings?.displayAlias?.trim() || user.fullName;
      }
      return user.fullName;
    }

    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        userId,
        status: 'linked',
        revokedAt: null,
        property: { estateId },
      },
      include: { property: true, settings: true },
      orderBy: [{ isPrimaryContact: 'desc' }],
      take: 1,
    });
    const membership = memberships[0];
    if (!membership) return user.fullName;

    const policy =
      membership.settings?.displayNamePolicy ??
      MEMBERSHIP_SETTINGS_DEFAULTS.displayNamePolicy;
    if (policy === 'alias') {
      const alias = membership.settings?.displayAlias?.trim();
      return alias || user.fullName;
    }
    if (policy === 'address') {
      const address = this.formatPropertyAddress(membership.property);
      return address || user.fullName;
    }
    return user.fullName;
  }

  /** Cualquier finca en común entre el usuario autenticado y `otherUserId` — no valida política, solo pertenencia. */
  private async findAnySharedEstateId(
    user: AuthenticatedUser,
    otherUserId: string,
  ): Promise<string | null> {
    if (user.estateIds.length === 0) return null;
    const other = await this.prisma.user.findUnique({
      where: { id: otherUserId },
      select: { role: true, administratorId: true },
    });
    if (!other) return null;

    if (other.role === 'B') {
      if (!other.administratorId) return null;
      const estate = await this.prisma.estate.findFirst({
        where: {
          id: { in: user.estateIds },
          administratorId: other.administratorId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return estate?.id ?? null;
    }

    const membership = await this.prisma.propertyMembership.findFirst({
      where: {
        userId: otherUserId,
        status: 'linked',
        revokedAt: null,
        property: { estateId: { in: user.estateIds } },
      },
      select: { property: { select: { estateId: true } } },
    });
    return membership?.property.estateId ?? null;
  }

  /**
   * Comparten finca Y su ajuste de privacidad lo permite. Para rol C:
   * "más permisiva gana" si tiene varias membresías en la finca compartida
   * (alcanza con que UNA no sea 'nobody'). Para rol B: su único ajuste
   * global en UserMessagingSettings (default 'anyone_linked', siempre
   * alcanzable salvo que lo desactive explícitamente).
   */
  private async assertEligibleRecipient(
    user: AuthenticatedUser,
    recipientId: string,
  ): Promise<string> {
    if (recipientId === user.id) {
      throw new BadRequestException(
        'No puedes enviarte un mensaje a ti mismo.',
      );
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { role: true },
    });
    if (!recipient) {
      throw new NotFoundException('Usuario destinatario no encontrado.');
    }

    const estateId = await this.findAnySharedEstateId(user, recipientId);
    if (!estateId) {
      throw new ForbiddenException(
        'No compartes ninguna finca con este usuario.',
      );
    }

    if (recipient.role === 'C') {
      const allowed = await this.prisma.propertyMembership.findFirst({
        where: {
          userId: recipientId,
          status: 'linked',
          revokedAt: null,
          property: { estateId: { in: user.estateIds } },
          OR: [
            { settings: null },
            { settings: { allowDirectMessages: { not: 'nobody' } } },
          ],
        },
      });
      if (!allowed) {
        throw new ForbiddenException(
          'Este usuario no admite mensajes directos.',
        );
      }
    } else if (recipient.role === 'B') {
      const settings = await this.prisma.userMessagingSettings.findUnique({
        where: { userId: recipientId },
      });
      const policy =
        settings?.allowDirectMessages ??
        USER_MESSAGING_SETTINGS_DEFAULTS.allowDirectMessages;
      if (policy === 'nobody') {
        throw new ForbiddenException(
          'Este usuario no admite mensajes directos.',
        );
      }
    }

    return estateId;
  }

  /**
   * Contactos posibles: para un rol C, otros propietarios de sus fincas
   * (que lo permitan) + los administradores (rol B) de esas fincas. Para un
   * rol B, los propietarios de las fincas que administra (que lo permitan).
   * No hay contactos B↔B — fuera de alcance.
   */
  private withEstateScope(user: AuthenticatedUser, estateId?: string): AuthenticatedUser {
    if (!estateId) return user;
    if (!user.estateIds.includes(estateId)) {
      throw new ForbiddenException('No tienes acceso a esta comunidad.');
    }
    return { ...user, estateIds: [estateId] };
  }

  async listContacts(user: AuthenticatedUser, estateId?: string): Promise<ContactRow[]> {
    user = this.withEstateScope(user, estateId);
    if (user.estateIds.length === 0) return [];
    const results = new Map<string, Omit<ContactRow, 'conversationId'>>();

    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        status: 'linked',
        revokedAt: null,
        userId: { not: user.id },
        property: { estateId: { in: user.estateIds } },
        OR: [
          { settings: null },
          { settings: { allowDirectMessages: { not: 'nobody' } } },
        ],
      },
      select: { userId: true, property: { select: { estateId: true } } },
      orderBy: { linkedAt: 'asc' },
    });
    for (const m of memberships) {
      if (results.has(m.userId) || !m.property.estateId) continue;
      const estateId = m.property.estateId;
      const displayName = await this.resolveDisplayName(m.userId, estateId);
      results.set(m.userId, { userId: m.userId, displayName, estateId });
    }

    if (user.role === 'C') {
      const estates = await this.prisma.estate.findMany({
        where: { id: { in: user.estateIds }, deletedAt: null },
        select: { id: true, administratorId: true },
      });
      const adminIds = [...new Set(estates.map((e) => e.administratorId))];
      if (adminIds.length > 0) {
        const admins = await this.prisma.user.findMany({
          where: {
            role: 'B',
            administratorId: { in: adminIds },
            OR: [
              { messagingSettings: null },
              { messagingSettings: { allowDirectMessages: { not: 'nobody' } } },
            ],
          },
          select: { id: true, administratorId: true },
        });
        for (const admin of admins) {
          if (results.has(admin.id)) continue;
          const estate = estates.find(
            (e) => e.administratorId === admin.administratorId,
          );
          if (!estate) continue;
          const displayName = await this.resolveDisplayName(
            admin.id,
            estate.id,
          );
          results.set(admin.id, {
            userId: admin.id,
            displayName,
            estateId: estate.id,
          });
        }
      }
    }

    const existing = results.size
      ? await this.prisma.directMessageParticipant.findMany({
          where: {
            userId: { in: [...results.keys()] },
            conversation: { participants: { some: { userId: user.id } } },
          },
          select: { userId: true, conversationId: true },
        })
      : [];
    const conversationByUser = new Map(existing.map((row) => [row.userId, row.conversationId]));
    return [...results.values()].map((contact) => ({
      ...contact,
      conversationId: conversationByUser.get(contact.userId) ?? null,
    }));
  }

  async listConversations(user: AuthenticatedUser, scopeEstateId?: string) {
    user = this.withEstateScope(user, scopeEstateId);
    const participantRows = await this.prisma.directMessageParticipant.findMany(
      {
        where: { userId: user.id, hiddenAt: null },
        include: {
          conversation: {
            include: {
              participants: true,
              messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { attachments: { select: { name: true }, take: 1 } } },
            },
          },
        },
      },
    );

    const summaries = await Promise.all(
      participantRows.map(async (row) => {
        const other = row.conversation.participants.find(
          (p) => p.userId !== user.id,
        );
        if (!other) return null;
        const lastMessage = row.conversation.messages[0] ?? null;
        const [unreadCount, estateId] = await Promise.all([
          this.prisma.directMessage.count({
            where: {
              conversationId: row.conversationId,
              senderId: { not: user.id },
              deletedAt: null,
              createdAt: { gt: row.lastReadAt ?? new Date(0) },
            },
          }),
          this.findAnySharedEstateId(user, other.userId),
        ]);
        if (scopeEstateId && !estateId) return null;
        const otherDisplayName = estateId
          ? await this.resolveDisplayName(other.userId, estateId)
          : ((
              await this.prisma.user.findUnique({
                where: { id: other.userId },
                select: { fullName: true },
              })
            )?.fullName ?? 'Usuario desconocido');
        return {
          id: row.conversationId,
          otherUserId: other.userId,
          otherDisplayName,
          estateId,
          lastMessageSenderId: lastMessage?.senderId ?? null,
          lastMessagePreview: lastMessage?.deletedAt
            ? DELETED_MESSAGE_PREVIEW
            : lastMessage?.text || (lastMessage?.attachments?.[0] ? `Adjunto: ${lastMessage.attachments[0].name}` : ''),
          lastMessageAt: (
            lastMessage?.createdAt ?? row.conversation.createdAt
          ).toISOString(),
          unreadCount,
        };
      }),
    );

    return summaries
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }

  async assertParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const row = await this.prisma.directMessageParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!row) {
      throw new ForbiddenException('No formas parte de esta conversación.');
    }
  }

  async listMessages(
    conversationId: string,
    user: AuthenticatedUser,
    opts: { limit?: number; before?: string } = {},
  ) {
    await this.assertParticipant(conversationId, user.id);
    const limit = Math.min(opts.limit ?? 50, 100);
    const other = await this.prisma.directMessageParticipant.findFirst({
      where: { conversationId, userId: { not: user.id } },
      select: { lastReadAt: true },
    });
    const messages = await this.prisma.directMessage.findMany({
      where: {
        conversationId,
        ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { attachments: { select: DIRECT_MESSAGE_ATTACHMENT_SELECT } },
    });
    // «Leído» = el otro participante abrió la conversación después de enviarse el mensaje.
    const readAt = other?.lastReadAt ?? null;
    return messages.reverse().map((message) => ({
      ...message,
      readByRecipient: message.senderId === user.id && !!readAt && readAt >= message.createdAt,
    }));
  }

  private async findOrCreateConversation(
    userAId: string,
    userBId: string,
  ): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        participants: { some: { userId: userAId } },
        AND: { participants: { some: { userId: userBId } } },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.conversation.create({
      data: {
        participants: { create: [{ userId: userAId }, { userId: userBId }] },
      },
      select: { id: true },
    });
    return created.id;
  }

  async ensureConversationAccess(dto: Pick<SendDirectMessageDto, 'conversationId' | 'recipientUserId'>, user: AuthenticatedUser): Promise<string> {
    let conversationId = dto.conversationId;

    if (!conversationId) {
      if (!dto.recipientUserId) {
        throw new BadRequestException(
          'Debes indicar conversationId o recipientUserId.',
        );
      }
      await this.assertEligibleRecipient(user, dto.recipientUserId);
      conversationId = await this.findOrCreateConversation(
        user.id,
        dto.recipientUserId,
      );
    } else {
      await this.assertParticipant(conversationId, user.id);
    }

    return conversationId;
  }

  async sendMessage(dto: SendDirectMessageDto, user: AuthenticatedUser) {
    const conversationId = await this.ensureConversationAccess(dto, user);
    const message = await this.prisma.directMessage.create({
      data: { conversationId, senderId: user.id, text: dto.text },
    });
    await this.revealConversation(conversationId);
    await this.notifyRecipient(conversationId, user);
    await this.logSent(conversationId, message.id, user);
    return message;
  }

  /** Un mensaje nuevo devuelve la conversación a la lista de quien la hubiera eliminado, con todo su historial. */
  async revealConversation(conversationId: string): Promise<void> {
    await this.prisma.directMessageParticipant.updateMany({
      where: { conversationId, hiddenAt: { not: null } },
      data: { hiddenAt: null },
    });
  }

  /** «Eliminar conversación»: solo desaparece de la lista de quien la elimina; el otro participante y el historial no se tocan. */
  async hideConversation(conversationId: string, user: AuthenticatedUser): Promise<void> {
    await this.assertParticipant(conversationId, user.id);
    const now = new Date();
    await this.prisma.directMessageParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { hiddenAt: now, lastReadAt: now },
    });
  }

  /**
   * Deja constancia en la actividad del gestor de que envió un mensaje (sin el texto:
   * solo a quién). Solo gestión (A/B) y de mejor esfuerzo: un fallo del registro no
   * debe deshacer un mensaje ya enviado. No lleva finca: una conversación no la tiene.
   */
  async logSent(conversationId: string, messageId: string, sender: AuthenticatedUser): Promise<void> {
    if (sender.role === 'C') return;
    try {
      const recipient = await this.prisma.directMessageParticipant.findFirst({
        where: { conversationId, userId: { not: sender.id } },
        select: { user: { select: { fullName: true } } },
      });
      await this.prisma.activityLogEntry.create({
        data: {
          actorUserId: sender.id,
          subjectType: 'message',
          subjectId: messageId,
          verb: 'created',
          summary: `Mensaje enviado a ${recipient?.user.fullName ?? 'un usuario'}`,
          occurredAt: new Date(),
          estateId: null,
          propertyId: null,
        },
      });
    } catch {
      // Best effort: el mensaje ya se guardó.
    }
  }

  /**
   * Un email por CONVERSACIÓN, no por mensaje — `dedupeKey` colapsa una
   * ráfaga de mensajes seguidos en un solo aviso mientras el destinatario no
   * lo haya leído (misma idea que un cliente de email agrupando un hilo).
   */
  async notifyRecipient(
    conversationId: string,
    sender: AuthenticatedUser,
  ): Promise<void> {
    const [recipient, senderUser] = await Promise.all([
      this.prisma.directMessageParticipant.findFirst({
        where: { conversationId, userId: { not: sender.id } },
        select: { userId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: sender.id },
        select: { fullName: true },
      }),
    ]);
    if (!recipient) return;
    const link = { B: '/b/messages', C: '/c/messages' };
    await this.notifications.notify({
      userIds: [recipient.userId],
      category: 'direct_message',
      title: `Nuevo mensaje de ${senderUser?.fullName ?? 'un usuario'}`,
      link,
      dedupeKey: `dm:${conversationId}`,
    });
  }

  async markRead(
    conversationId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertParticipant(conversationId, user.id);
    await this.prisma.directMessageParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: new Date() },
    });
  }

  /**
   * Ajustes globales de mensajería para usuarios sin PropertyMembership
   * (rol A/B) — equivalente de MembershipSettingsService.getMine/updateMine
   * pero por userId en vez de (propertyId, userId).
   */
  async getMySettings(
    user: AuthenticatedUser,
  ): Promise<UserMessagingSettingsValues> {
    const settings = await this.prisma.userMessagingSettings.findUnique({
      where: { userId: user.id },
    });
    if (!settings) return { ...USER_MESSAGING_SETTINGS_DEFAULTS };
    return {
      allowDirectMessages: settings.allowDirectMessages,
      displayNamePolicy: settings.displayNamePolicy,
      displayAlias: settings.displayAlias,
    };
  }

  async updateMySettings(
    user: AuthenticatedUser,
    dto: UpdateUserMessagingSettingsDto,
  ): Promise<UserMessagingSettingsValues> {
    const settings = await this.prisma.userMessagingSettings.upsert({
      where: { userId: user.id },
      update: { ...dto },
      create: { userId: user.id, ...USER_MESSAGING_SETTINGS_DEFAULTS, ...dto },
    });
    return {
      allowDirectMessages: settings.allowDirectMessages,
      displayNamePolicy: settings.displayNamePolicy,
      displayAlias: settings.displayAlias,
    };
  }
}
