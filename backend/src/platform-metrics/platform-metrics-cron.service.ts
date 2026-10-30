import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PlatformMetricsService } from './platform-metrics.service';

/**
 * Captures the MRR snapshot of the current month every night: the history the
 * MRR chart and the movements need cannot be rebuilt later. Idempotent, so the
 * month closes with its last day's value.
 */
@Injectable()
export class PlatformMetricsCronService {
  private readonly logger = new Logger(PlatformMetricsCronService.name);

  constructor(private readonly metrics: PlatformMetricsService) {}

  @Cron('0 30 23 * * *')
  async run(): Promise<void> {
    try {
      await this.metrics.captureCurrentMonth();
    } catch (error) {
      this.logger.error('Error capturando el MRR del mes', error);
    }
  }
}
