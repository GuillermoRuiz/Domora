import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ownerReceiptsLink } from '../common/owner-links';

const REMINDER_BEFORE_DUE_DAYS = 3; // aviso único, unos días antes de que venza
const REMINDER_REPEAT_DAYS = 7; // mientras siga impago, un recordatorio semanal (no diario)

/** Misma razón que en MeetingsNotificationsCronService: Prisma devuelve Timestamptz en UTC sin importar el TZ del proceso. */
function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/**
 * ID 22 — recordatorio de recibo pendiente de pago, el único de los 3 avisos
 * nuevos de esta tarea que necesita disparador temporal (recibo nuevo/ticket
 * nuevo/reserva cancelada son eventos síncronos). Mismo esqueleto que
 * MeetingsNotificationsCronService, pero SÍ pasa por NotificationsService
 * (no por MailService directo): es la única vía que respeta `notifyReceipts`,
 * la preferencia que esta tarea existe para conectar.
 */
@Injectable()
export class ReceiptReminderCronService {
  private readonly logger = new Logger(ReceiptReminderCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    try {
      await this.remindPendingReceipts();
    } catch (error) {
      this.logger.error('Error enviando recordatorios de recibo pendiente', error);
    }
  }

  private async remindPendingReceipts(): Promise<void> {
    const today = startOfDay(new Date());
    const candidates = await this.prisma.accountingReceipt.findMany({
      where: {
        status: { in: ['Pendiente', 'Parcial'] },
        dueDate: { not: null },
        ownerUserId: { not: null },
      },
      select: {
        id: true,
        no: true,
        dueDate: true,
        reminderSentAt: true,
        ownerUserId: true,
        propertyId: true,
        estateId: true,
      },
    });

    const due = candidates.filter((receipt) => {
      // Ya se avisó hoy — evita reenviar si el cron corre más de una vez o hay varias réplicas.
      if (receipt.reminderSentAt && startOfDay(receipt.reminderSentAt).getTime() === today.getTime()) {
        return false;
      }
      const daysUntilDue = daysBetween(today, receipt.dueDate!);
      if (daysUntilDue === REMINDER_BEFORE_DUE_DAYS) return true;
      if (daysUntilDue < 0) {
        const daysOverdue = -daysUntilDue;
        return daysOverdue % REMINDER_REPEAT_DAYS === 0;
      }
      return false;
    });

    for (const receipt of due) {
      await this.notifications.notify({
        userIds: [receipt.ownerUserId!],
        category: 'receipt',
        title:
          daysBetween(today, receipt.dueDate!) >= 0
            ? `Tu recibo ${receipt.no} vence en ${REMINDER_BEFORE_DUE_DAYS} días`
            : `Tu recibo ${receipt.no} sigue pendiente de pago`,
        link: ownerReceiptsLink(receipt.propertyId, receipt.id),
        estateId: receipt.estateId,
        propertyId: receipt.propertyId,
      });
      await this.prisma.accountingReceipt.update({
        where: { id: receipt.id },
        data: { reminderSentAt: new Date() },
      });
    }
  }
}
