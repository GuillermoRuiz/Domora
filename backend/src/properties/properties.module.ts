import { Module } from '@nestjs/common';
import {
  EstateOnboardingRequestsController,
  EstatePropertiesController,
  PropertiesController,
} from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyOverviewService } from './property-overview.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { DebtorsModule } from '../debtors/debtors.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EstateAccessModule, DebtorsModule, NotificationsModule],
  controllers: [
    EstatePropertiesController,
    PropertiesController,
    EstateOnboardingRequestsController,
  ],
  providers: [PropertiesService, PropertyOverviewService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
