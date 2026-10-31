import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  PlatformMetricsService,
  type BusinessEvent,
  type MrrOverview,
} from './platform-metrics.service';

// Domora business metrics for the platform superadmin panel.
@Controller('platform-metrics')
export class PlatformMetricsController {
  constructor(private readonly metrics: PlatformMetricsService) {}

  @Get('mrr')
  @Roles('A')
  mrr(): Promise<MrrOverview> {
    return this.metrics.mrrOverview();
  }

  @Get('activity')
  @Roles('A')
  activity(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<BusinessEvent[]> {
    return this.metrics.recentActivity(limit);
  }
}
