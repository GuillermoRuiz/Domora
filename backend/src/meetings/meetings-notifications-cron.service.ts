import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const ACTA_DEADLINE_DAYS = 10; // art. 19 LPH
const ACTA_REMINDER_WINDOW_DAYS = 3; // solo avisa cuando ya queda poco, no desde el día 1

/** Misma razón que en InspectionsCronService: Prisma devuelve Timestamptz en UTC sin importar el TZ del proceso. */
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
 * Fase 2.4 — mismo patrón que InspectionsCronService (@Cron diario, todo
 * en try/catch, idempotente entre réplicas vía `actaReminderSentAt`).
 *
 * Única responsabilidad con disparador temporal real de las notificaciones
 * de esta fase: "votación abierta" y "acta firmada y distribuida" son
 * eventos síncronos (se disparan desde `VoteSessionsService.open()` y
 * `MeetingsService.sendActaNotice()`, no necesitan cron). "Votación a
 * punto de cerrar" queda fuera de alcance — `VoteSession` no tiene fecha
 * límite en este diseño (ver plan, sección "Backlog").
 */
@Injectable()
export class MeetingsNotificationsCronService {
  private readonly logger = new Logger(MeetingsNotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    try {
      await this.remindPendingActas();
    } catch (error) {
      this.logger.error(
        'Error enviando recordatorios de acta pendiente de firma',
        error,
      );
    }
  }

  private async remindPendingActas(): Promise<void> {
    const today = startOfDay(new Date());
    const candidates = await this.prisma.meeting.findMany({
      where: {
        status: 'celebrada',
        actaSignedAt: null,
        celebratedAt: { not: null },
      },
      select: {
        id: true,
        title: true,
        celebratedAt: true,
        actaReminderSentAt: true,
        estate: { select: { administratorId: true } },
      },
    });

    const dueSoon = candidates.filter((meeting) => {
      const deadline = new Date(
        meeting.celebratedAt!.getTime() + ACTA_DEADLINE_DAYS * 86_400_000,
      );
      const daysRemaining = daysBetween(today, deadline);
      if (daysRemaining > ACTA_REMINDER_WINDOW_DAYS) return false;
      // Ya se avisó hoy — evita reenviar si el cron corre más de una vez o hay varias réplicas.
      if (
        meeting.actaReminderSentAt &&
        startOfDay(meeting.actaReminderSentAt).getTime() === today.getTime()
      ) {
        return false;
      }
      return true;
    });

    for (const meeting of dueSoon) {
      const deadline = new Date(
        meeting.celebratedAt!.getTime() + ACTA_DEADLINE_DAYS * 86_400_000,
      );
      const daysRemaining = daysBetween(today, deadline);

      // Avisa a la gestora (rol B), no a un presidente/secretario
      // pre-designado — la firma se resuelve por email en el momento de
      // firmar (ver ActaDocxService/SignActaDto), no hay a quién avisar
      // hasta entonces salvo al equipo responsable de conseguir la firma.
      const managers = await this.prisma.user.findMany({
        where: {
          administratorId: meeting.estate.administratorId,
          role: 'B',
          deletedAt: null,
        },
        select: { email: true },
      });
      for (const manager of managers) {
        try {
          await this.mail.sendActaReadyToSign(
            manager.email,
            meeting.title,
            daysRemaining,
          );
        } catch (error) {
          this.logger.error(
            `No se pudo enviar el recordatorio de acta a ${manager.email} (junta ${meeting.id})`,
            error,
          );
        }
      }
      await this.prisma.meeting.update({
        where: { id: meeting.id },
        data: { actaReminderSentAt: new Date() },
      });
    }
  }
}
