import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const GRACE_PERIOD_DAYS = 7;

/**
 * ID 17 — agota el período de gracia de 7 días que `BillingService.
 * applyAdminStatusFromStripe` arranca en el primer `past_due` (ver
 * `AdministratorSubscription.pastDueSince`). Mismo esqueleto que
 * `ReceiptReminderCronService`: `@Cron` diario, try/catch que nunca
 * revienta el proceso. A diferencia de ese cron, no hace falta una guarda
 * de "ya avisado hoy": `restrictForExpiredGrace` limpia `pastDueSince`, así
 * que una gestora restringida sale sola de la consulta en la próxima
 * corrida — no hay riesgo de reprocesarla.
 */
@Injectable()
export class SubscriptionGraceCronService {
  private readonly logger = new Logger(SubscriptionGraceCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error(
        'Error agotando períodos de gracia de suscripción',
        error,
      );
    }
  }

  private async sweep(): Promise<void> {
    const cutoff = new Date(
      Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
    const candidates = await this.prisma.administratorSubscription.findMany({
      where: {
        status: 'past_due',
        pastDueSince: { lte: cutoff },
        administrator: { status: 'Activa' },
      },
      select: { administratorId: true },
    });

    for (const { administratorId } of candidates) {
      await this.billing.restrictForExpiredGrace(administratorId);
    }
  }
}
