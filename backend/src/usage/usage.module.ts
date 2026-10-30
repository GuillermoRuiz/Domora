import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UsageInterceptor } from './usage.interceptor';
import { UsageRecorder } from './usage-recorder.service';
import { UsageService } from './usage.service';

/**
 * Platform usage capture (S15). The interceptor is global. It also runs in
 * DEMO_MODE on purpose: its flush is a plain timer (not a @Cron, so it does
 * not depend on ScheduleModule), it only writes to the local database (no
 * external service) and it lets the demo's role A panel show real usage.
 */
@Module({
  providers: [UsageRecorder, UsageService, { provide: APP_INTERCEPTOR, useClass: UsageInterceptor }],
  exports: [UsageService],
})
export class UsageModule {}
