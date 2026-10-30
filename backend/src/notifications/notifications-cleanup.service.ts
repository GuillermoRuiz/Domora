import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

/** Los avisos leídos no tienen valor histórico: se conservan este tiempo y se borran. */
const READ_RETENTION_DAYS = 90;

/**
 * Mismo patrón que `TokenCleanupService`: `@Cron` semanal con todo en un
 * try/catch (un fallo aquí nunca debe tumbar el proceso).
 */
@Injectable()
export class NotificationsCleanupService {
  private readonly logger = new Logger(NotificationsCleanupService.name);

  constructor(private readonly notifications: NotificationsService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async run(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - READ_RETENTION_DAYS * 86_400_000);
      const deleted = await this.notifications.deleteReadBefore(cutoff);
      if (deleted > 0) {
        this.logger.log(
          `${deleted} aviso(s) leído(s) con más de ${READ_RETENTION_DAYS} días eliminados.`,
        );
      }
    } catch (error) {
      this.logger.error('Error limpiando avisos leídos', error);
    }
  }
}
