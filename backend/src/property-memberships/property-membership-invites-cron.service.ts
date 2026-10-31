import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const REMINDER_WINDOW_DAYS = 2; // solo avisa cuando ya queda poco de los 7 días de validez, no desde el alta

/** Misma razón que en InspectionsCronService/MeetingsNotificationsCronService: Prisma devuelve Timestamptz en UTC sin importar el TZ del proceso. */
function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

/**
 * Recuerda al invitado que su invitación (a `PropertyMembership`, no a la
 * finca) está por caducar — mismo patrón que `MeetingsNotificationsCronService`
 * (@Cron diario, idempotente vía `reminderSentAt`). A diferencia de esa
 * misma clase, el destinatario es el propio invitado (`inviteeEmail`), no la
 * gestora.
 */
@Injectable()
export class PropertyMembershipInvitesCronService {
  private readonly logger = new Logger(
    PropertyMembershipInvitesCronService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    try {
      await this.remindExpiringInvites();
    } catch (error) {
      this.logger.error(
        'Error enviando recordatorios de invitación pendiente',
        error,
      );
    }
  }

  private async remindExpiringInvites(): Promise<void> {
    const today = startOfDay(new Date());
    const candidates = await this.prisma.propertyMembershipInvite.findMany({
      where: { usedAt: null, revokedAt: null },
      include: {
        property: {
          select: {
            viaType: true,
            viaName: true,
            streetNumber: true,
            staircase: true,
            floor: true,
            door: true,
          },
        },
      },
    });

    const dueSoon = candidates.filter((invite) => {
      const daysRemaining = daysBetween(today, invite.expiresAt);
      if (daysRemaining > REMINDER_WINDOW_DAYS || daysRemaining < 0)
        return false;
      // Ya se avisó hoy — evita reenviar si el cron corre más de una vez o hay varias réplicas.
      if (
        invite.reminderSentAt &&
        startOfDay(invite.reminderSentAt).getTime() === today.getTime()
      ) {
        return false;
      }
      return true;
    });

    for (const invite of dueSoon) {
      const daysRemaining = daysBetween(today, invite.expiresAt);
      const address = [
        invite.property.viaType,
        invite.property.viaName,
        invite.property.streetNumber,
        invite.property.staircase && `esc. ${invite.property.staircase}`,
        invite.property.floor && `${invite.property.floor}º`,
        invite.property.door,
      ]
        .filter(Boolean)
        .join(' ');
      try {
        await this.mail.sendMembershipInviteReminder(
          invite.inviteeEmail,
          invite.roleType,
          address,
          daysRemaining,
        );
      } catch (error) {
        this.logger.error(
          `No se pudo enviar el recordatorio de invitación a ${invite.inviteeEmail} (${invite.id})`,
          error,
        );
      }
      await this.prisma.propertyMembershipInvite.update({
        where: { id: invite.id },
        data: { reminderSentAt: new Date() },
      });
    }
  }
}
