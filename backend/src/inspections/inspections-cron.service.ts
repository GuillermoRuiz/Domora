import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * En UTC, no en hora local: `nextDueDate`/`lastReminderSentAt` viajan como
 * `@db.Date`/`Timestamptz` de Postgres, que Prisma siempre devuelve en UTC
 * sin importar el `TZ` del proceso — nada fija `TZ=UTC` en el contenedor
 * (ver docker-compose.yml). Usar `setHours` (hora local) desplazaría el
 * límite del día un día entero en cualquier despliegue que no corra en UTC.
 */
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
 * Mismo patrón que TokenCleanupService (auth/token-cleanup.service.ts):
 * @Cron diario, todo envuelto en try/catch (un fallo aquí nunca debe tumbar
 * el proceso), idempotente entre réplicas.
 *
 * Dos responsabilidades, deliberadamente en el mismo cron porque comparten
 * la misma consulta base (inspecciones con fecha límite):
 *  1) auto-vencida: domora-es nunca hacía esta transición sola (gap
 *     conocido del origen portado) — aquí sí, sin esperar a que alguien la
 *     edite a mano.
 *  2) recordatorio de vencimiento al equipo de la gestora (rol B), dentro
 *     de la ventana `reminderDaysBefore` — mismo algoritmo que el edge
 *     function `notify-upcoming-inspections` del origen, pero con envío de
 *     email real (MailService) en vez de solo un registro en BD.
 */
@Injectable()
export class InspectionsCronService {
  private readonly logger = new Logger(InspectionsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    try {
      await this.markOverdue();
    } catch (error) {
      this.logger.error('Error marcando inspecciones vencidas', error);
    }
    try {
      await this.sendReminders();
    } catch (error) {
      this.logger.error('Error enviando recordatorios de inspección', error);
    }
  }

  private async markOverdue(): Promise<void> {
    const today = startOfDay(new Date());
    const { count } = await this.prisma.regulatoryInspection.updateMany({
      where: {
        status: { in: ['planificada', 'citada'] },
        nextDueDate: { lt: today },
      },
      data: { status: 'vencida' },
    });
    if (count > 0) {
      this.logger.log(
        `${count} inspección(es) pasadas a "vencida" por vencimiento.`,
      );
    }
  }

  private async sendReminders(): Promise<void> {
    const today = startOfDay(new Date());
    const candidates = await this.prisma.regulatoryInspection.findMany({
      where: {
        status: { in: ['planificada', 'citada'] },
        nextDueDate: { gte: today },
      },
      include: {
        asset: { select: { name: true } },
        inspectionType: { select: { name: true } },
      },
    });

    const dueSoon = candidates.filter((inspection) => {
      if (!inspection.nextDueDate) return false;
      const daysRemaining = daysBetween(today, inspection.nextDueDate);
      if (daysRemaining > inspection.reminderDaysBefore) return false;
      // Ya se avisó hoy — evita reenviar si el cron corre más de una vez o
      // hay varias réplicas del proceso corriendo el mismo @Cron.
      if (
        inspection.lastReminderSentAt &&
        startOfDay(inspection.lastReminderSentAt).getTime() === today.getTime()
      ) {
        return false;
      }
      return true;
    });

    for (const inspection of dueSoon) {
      const managerIds = await this.notifications.managerIdsOfEstate(inspection.estateId);
      const daysRemaining = daysBetween(today, inspection.nextDueDate!);
      const whenLine = daysRemaining <= 1 ? 'vence mañana' : `vence en ${daysRemaining} días`;
      const dueDateLabel = inspection.nextDueDate!.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      await this.notifications.notify({
        userIds: managerIds,
        category: 'inspection',
        title: `${inspection.inspectionType.name} próxima a vencer`,
        body: `La inspección de "${inspection.asset.name}" (${inspection.inspectionType.name}) ${whenLine} (${dueDateLabel}).`,
        link: `/b/estates/${inspection.estateId}?tab=inspections`,
        estateId: inspection.estateId,
      });
      await this.prisma.regulatoryInspection.update({
        where: { id: inspection.id },
        data: { lastReminderSentAt: new Date() },
      });
    }
  }
}
