import { Module } from '@nestjs/common';
import { PlatformMetricsController } from './platform-metrics.controller';
import { PlatformMetricsCronService } from './platform-metrics-cron.service';
import { PlatformMetricsService } from './platform-metrics.service';

@Module({
  controllers: [PlatformMetricsController],
  providers: [PlatformMetricsService, PlatformMetricsCronService],
  exports: [PlatformMetricsService],
})
export class PlatformMetricsModule {}
