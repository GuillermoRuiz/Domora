import { Module } from '@nestjs/common';
import {
  AmenitiesController,
  BookingsController,
  EstateAmenitiesController,
} from './amenities.controller';
import { AmenitiesService } from './amenities.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EstateAccessModule, NotificationsModule],
  controllers: [
    EstateAmenitiesController,
    AmenitiesController,
    BookingsController,
  ],
  providers: [AmenitiesService],
  exports: [AmenitiesService],
})
export class AmenitiesModule {}
