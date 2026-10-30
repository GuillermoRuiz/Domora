import { Module } from '@nestjs/common';
import { ClientStatusModule } from '../client-status/client-status.module';
import { CompletenessModule } from '../completeness/completeness.module';
import { UsageModule } from '../usage/usage.module';
import { CLIENT_HEALTH_CONFIG, DEFAULT_CLIENT_HEALTH_CONFIG } from './client-health.config';
import { ClientHealthController } from './client-health.controller';
import { ClientHealthService } from './client-health.service';
import { SUPPORT_SIGNAL_SOURCE, UnavailableSupportSignalSource } from './support-signal';

@Module({
  imports: [CompletenessModule, ClientStatusModule, UsageModule],
  controllers: [ClientHealthController],
  providers: [
    ClientHealthService,
    { provide: CLIENT_HEALTH_CONFIG, useValue: DEFAULT_CLIENT_HEALTH_CONFIG },
    // Until Soporte e incidencias exists (S16): the signal is unavailable, never a deduction.
    { provide: SUPPORT_SIGNAL_SOURCE, useClass: UnavailableSupportSignalSource },
  ],
  exports: [ClientHealthService],
})
export class ClientHealthModule {}
