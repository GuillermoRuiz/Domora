import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationCategory,
  Prisma,
  type NotificationSetting,
} from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PushService } from '../push/push.service';
import { resolveFrontendBaseUrl } from '../common/frontend-url';
import { MEMBERSHIP_SETTINGS_DEFAULTS } from '../property-memberships/membership-settings.defaults';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { TasksService } from './tasks.service';
import type { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

/**
 * Único punto de emisión de avisos: escribe la fila de la bandeja y decide
 * si además sale un email, según las preferencias del destinatario. Los
 * módulos de dominio (adhesiones, inspecciones, mensajes…) solo llaman a
 * `notify()`; ninguno envía emails de aviso por su cuenta.
 */
export interface NotifyInput {
  userIds: string[];
  category: NotificationCategory;
  title: string;
  body?: string | null;
  /**
   * Ruta del frontend (`/b/requests`); en el email se antepone el origen.
   * Si los destinatarios son de roles distintos (cada rol tiene su propio
   * árbol de rutas) se indica una por rol.
   */
  link: string | Partial<Record<AppRole, string>>;
  estateId?: string | null;
  propertyId?: string | null;
  /**
   * Colapsa avisos repetidos: mientras exista uno NO leído con la misma clave
   * para el usuario, se refresca en vez de crear otro — y NO se reenvía el
   * email (p. ej. veinte mensajes seguidos de una conversación son un solo
   * aviso y un solo email hasta que se lea).
   */
  dedupeKey?: string;
  /**
   * Con `dedupeKey`: el aviso sale UNA sola vez por clave, lo haya leído ya el usuario o no. Para avisos que responden a un
   * hecho único (un evento del expediente): si el proceso que los entregó muere y se reintenta, no se repite ni la bandeja
   * ni el email.
   */
  once?: boolean;
}

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string;
  estateId: string | null;
  propertyId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationSummary {
  unreadNotifications: number;
  unreadMessages: number;
  pendingTasks: number;
}

interface Delivery {
  inApp: boolean;
  email: boolean;
}

/**
 * Qué preferencia por vivienda (`PropertyMembershipSettings`) gobierna cada
 * categoría para un propietario. Las demás no tienen preferencia propia: se
 * entregan siempre (bandeja + email).
 */
const OWNER_PREFERENCE_FIELD: Partial<
  Record<
    NotificationCategory,
    | 'notifyIssues'
    | 'notifyDirectMessages'
    | 'notifyCommunications'
    | 'notifyBookings'
    | 'notifyReceipts'
  >
> = {
  issue: 'notifyIssues',
  direct_message: 'notifyDirectMessages',
  communication: 'notifyCommunications',
  // Un documento publicado a la comunidad es información de la comunidad: misma preferencia que los comunicados.
  document: 'notifyCommunications',
  booking: 'notifyBookings',
  receipt: 'notifyReceipts',
};

/** `push` en la preferencia es la bandeja de la propia app. */
function deliveryFromSetting(setting: NotificationSetting): Delivery {
  return {
    inApp: setting === 'push_only' || setting === 'email_push',
    email: setting === 'email_only' || setting === 'email_push',
  };
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const EMAIL_ERROR_MAX = 255;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly tasks: TasksService,
    private readonly push: PushService,
  ) {}

  // ── Emisión ──────────────────────────────────────────────────────────────

  /**
   * Nunca lanza: un aviso que falla no debe tumbar la operación de negocio
   * que lo originó (aprobar una solicitud, cambiar el estado de una junta…),
   * que ya se confirmó en base de datos.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (error) {
      this.logger.error(
        `No se pudo emitir el aviso "${input.title}" (${input.category})`,
        error,
      );
    }
  }

  private async deliver(input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    const deliveries = await this.resolveDeliveries(
      users,
      input.category,
      input.propertyId ?? null,
    );
    const baseUrl = resolveFrontendBaseUrl(this.config);

    for (const user of users) {
      const delivery = deliveries.get(user.id);
      if (!delivery || (!delivery.inApp && !delivery.email)) continue;
      try {
        const link = this.linkFor(input.link, user.role);
        await this.deliverTo(user, delivery, input, link, `${baseUrl}${link}`);
      } catch (error) {
        this.logger.error(
          `No se pudo avisar al usuario ${user.id} ("${input.title}")`,
          error,
        );
      }
    }
  }

  private linkFor(link: NotifyInput['link'], role: string): string {
    if (typeof link === 'string') return link;
    return link[role as AppRole] ?? Object.values(link)[0] ?? '/';
  }

  private async resolveDeliveries(
    users: { id: string; role: string }[],
    category: NotificationCategory,
    propertyId: string | null,
  ): Promise<Map<string, Delivery>> {
    const result = new Map<string, Delivery>();

    // Gestora y soporte: siempre bandeja; el email es una preferencia por
    // categoría (sin fila = activado).
    const staffIds = users.filter((u) => u.role !== 'C').map((u) => u.id);
    if (staffIds.length > 0) {
      const prefs = await this.prisma.userNotificationPreference.findMany({
        where: { userId: { in: staffIds }, category },
      });
      const emailByUser = new Map(prefs.map((p) => [p.userId, p.emailEnabled]));
      for (const id of staffIds) {
        result.set(id, { inApp: true, email: emailByUser.get(id) ?? true });
      }
    }

    const ownerIds = users.filter((u) => u.role === 'C').map((u) => u.id);
    if (ownerIds.length === 0) return result;
    const field = OWNER_PREFERENCE_FIELD[category];
    if (!field) {
      for (const id of ownerIds) result.set(id, { inApp: true, email: true });
      return result;
    }

    // Propietarios: la preferencia es por vivienda. Con varias viviendas basta
    // con que UNA permita el canal; si el aviso es de una vivienda concreta,
    // solo cuenta esa.
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        userId: { in: ownerIds },
        status: 'linked',
        revokedAt: null,
        ...(propertyId ? { propertyId } : {}),
      },
      include: { settings: true },
    });
    for (const id of ownerIds) {
      const settings = memberships
        .filter((m) => m.userId === id)
        .map((m) => m.settings?.[field] ?? MEMBERSHIP_SETTINGS_DEFAULTS[field]);
      const deliveries = (
        settings.length > 0 ? settings : [MEMBERSHIP_SETTINGS_DEFAULTS[field]]
      ).map(deliveryFromSetting);
      result.set(id, {
        inApp: deliveries.some((d) => d.inApp),
        email: deliveries.some((d) => d.email),
      });
    }
    return result;
  }

  private async deliverTo(
    user: { id: string; email: string },
    delivery: Delivery,
    input: NotifyInput,
    link: string,
    url: string,
  ): Promise<void> {
    let created = true;
    let rowId: string | null = null;
    if (delivery.inApp) {
      ({ created, id: rowId } = await this.upsertRow(user.id, input, link));
      // "push" en la preferencia es la bandeja — el push REAL (notificación
      // del sistema operativo) viaja siempre que la bandeja lo haga, a
      // cualquier suscripción activa del dispositivo. Mismo criterio que el
      // email: solo en un aviso genuinamente nuevo, no en un colapso.
      if (created) {
        await this.push.sendToUser(user.id, {
          title: input.title,
          body: input.body ?? null,
          url,
        });
      }
    }
    // Solo se envía email cuando aparece un aviso NUEVO (no en un colapso).
    if (!delivery.email || !created) return;

    let emailStatus: 'sent' | 'failed' = 'sent';
    let emailError: string | null = null;
    try {
      await this.mail.sendNotificationEmail(
        user.email,
        input.title,
        input.body ?? null,
        url,
      );
    } catch (error) {
      emailStatus = 'failed';
      emailError = String(error).slice(0, EMAIL_ERROR_MAX);
      this.logger.warn(
        `No se pudo enviar el email a ${user.email}: ${emailError}`,
      );
    }
    if (rowId) {
      await this.prisma.notification.update({
        where: { id: rowId },
        data: { emailStatus, emailError },
      });
    }
  }

  private async upsertRow(
    userId: string,
    input: NotifyInput,
    link: string,
  ): Promise<{ id: string | null; created: boolean }> {
    const data = {
      title: input.title,
      body: input.body ?? null,
      link,
      estateId: input.estateId ?? null,
      propertyId: input.propertyId ?? null,
    };
    if (input.once && input.dedupeKey) {
      const already = await this.prisma.notification.findFirst({
        where: { userId, dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (already) return { id: null, created: false };
    }
    if (
      input.dedupeKey &&
      (await this.refreshUnread(userId, input.dedupeKey, data))
    ) {
      return { id: null, created: false };
    }
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId,
          category: input.category,
          dedupeKey: input.dedupeKey ?? null,
          ...data,
        },
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (error) {
      // Carrera: otro proceso creó el aviso no leído entre el refresco y el
      // insert (índice único parcial) — se refresca ese en vez de fallar.
      if (
        input.dedupeKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (await this.refreshUnread(userId, input.dedupeKey, data))
      ) {
        return { id: null, created: false };
      }
      throw error;
    }
  }

  private async refreshUnread(
    userId: string,
    dedupeKey: string,
    data: Prisma.NotificationUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, dedupeKey, readAt: null },
      data: { ...data, createdAt: new Date() },
    });
    return count > 0;
  }

  // ── Destinatarios habituales ─────────────────────────────────────────────

  /** Equipo de la gestora (rol B) que administra la finca. */
  async managerIdsOfEstate(estateId: string): Promise<string[]> {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { administratorId: true },
    });
    if (!estate) return [];
    const managers = await this.prisma.user.findMany({
      where: {
        administratorId: estate.administratorId,
        role: 'B',
        deletedAt: null,
      },
      select: { id: true },
    });
    return managers.map((m) => m.id);
  }

  /** Todo el equipo (rol B) de una gestora — a diferencia de `managerIdsOfEstate`, sin saltar por ninguna finca (usado por BillingService, que ya tiene el administratorId de mano). */
  async administratorTeamUserIds(administratorId: string): Promise<string[]> {
    const team = await this.prisma.user.findMany({
      where: { administratorId, role: 'B', deletedAt: null },
      select: { id: true },
    });
    return team.map((u) => u.id);
  }

  /** Propietarios e inquilinos con vínculo activo en una finca o en una vivienda. */
  async residentIds(scope: {
    estateId?: string;
    propertyId?: string;
  }): Promise<string[]> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        status: 'linked',
        revokedAt: null,
        roleType: { in: ['Propietario', 'Inquilino'] },
        property: {
          deletedAt: null,
          ...(scope.propertyId ? { id: scope.propertyId } : {}),
          ...(scope.estateId ? { estateId: scope.estateId } : {}),
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return memberships.map((m) => m.userId);
  }

  /** Equipo de soporte de la plataforma (rol A). */
  async supportIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { role: 'A', deletedAt: null },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  // ── Bandeja del usuario ──────────────────────────────────────────────────

  async list(
    user: AuthenticatedUser,
    query: { unread?: boolean; limit?: number; before?: string },
  ): Promise<NotificationItem[]> {
    const take = Math.min(
      Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const rows = await this.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(query.unread ? { readAt: null } : {}),
        ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((n) => ({
      id: n.id,
      category: n.category,
      title: n.title,
      body: n.body,
      link: n.link,
      estateId: n.estateId,
      propertyId: n.propertyId,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async summary(user: AuthenticatedUser): Promise<NotificationSummary> {
    const [unreadNotifications, unreadMessages, pendingTasks] =
      await Promise.all([
        this.prisma.notification.count({
          where: { userId: user.id, readAt: null },
        }),
        this.countUnreadMessages(user.id),
        this.tasks.countPending(user),
      ]);
    return { unreadNotifications, unreadMessages, pendingTasks };
  }

  /**
   * Una sola consulta para todas las conversaciones (no una por conversación,
   * como hace `DirectMessagesService.listConversations`): mensajes de otros
   * posteriores a la última lectura del usuario en cada una.
   */
  private async countUnreadMessages(userId: string): Promise<number> {
    const participations = await this.prisma.directMessageParticipant.findMany({
      where: { userId },
      select: { conversationId: true, lastReadAt: true },
    });
    if (participations.length === 0) return 0;
    return this.prisma.directMessage.count({
      where: {
        senderId: { not: userId },
        OR: participations.map((p) => ({
          conversationId: p.conversationId,
          createdAt: { gt: p.lastReadAt ?? new Date(0) },
        })),
      },
    });
  }

  async markRead(user: AuthenticatedUser, id: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { readAt: true },
    });
    if (!notification) {
      throw new NotFoundException(`Notificación ${id} no encontrada.`);
    }
    if (notification.readAt) return;
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: AuthenticatedUser): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ── Preferencias de email (gestora y soporte) ────────────────────────────

  async getPreferences(
    user: AuthenticatedUser,
  ): Promise<{ category: NotificationCategory; emailEnabled: boolean }[]> {
    const rows = await this.prisma.userNotificationPreference.findMany({
      where: { userId: user.id },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r.emailEnabled]));
    return Object.values(NotificationCategory).map((category) => ({
      category,
      emailEnabled: byCategory.get(category) ?? true,
    }));
  }

  async updatePreferences(
    user: AuthenticatedUser,
    dto: UpdateNotificationPreferencesDto,
  ) {
    await this.prisma.$transaction(
      dto.preferences.map((p) =>
        this.prisma.userNotificationPreference.upsert({
          where: {
            userId_category: { userId: user.id, category: p.category },
          },
          update: { emailEnabled: p.emailEnabled },
          create: {
            userId: user.id,
            category: p.category,
            emailEnabled: p.emailEnabled,
          },
        }),
      ),
    );
    return this.getPreferences(user);
  }

  // ── Mantenimiento ────────────────────────────────────────────────────────

  /** Borra los avisos ya leídos anteriores a `olderThan`. Devuelve cuántos. */
  async deleteReadBefore(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { readAt: { lt: olderThan } },
    });
    return count;
  }
}
