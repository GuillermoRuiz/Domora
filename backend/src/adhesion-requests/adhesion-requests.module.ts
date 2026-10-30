import { Module } from '@nestjs/common';
import {
  AdhesionRequestsController,
  AllAdhesionRequestsController,
} from './adhesion-requests.controller';
import { AdhesionRequestsService } from './adhesion-requests.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EstateAccessModule, NotificationsModule],
  controllers: [AdhesionRequestsController, AllAdhesionRequestsController],
  providers: [AdhesionRequestsService],
  exports: [AdhesionRequestsService],
})
export class AdhesionRequestsModule {}
