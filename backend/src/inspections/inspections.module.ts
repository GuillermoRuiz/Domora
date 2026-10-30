import { Module } from '@nestjs/common';
import {
  EstateAssetsController,
  EstateInspectionTypesController,
  EstateInstallationsController,
} from './assets.controller';
import {
  EstateInspectionsController,
  InspectionsController,
} from './inspections.controller';
import { AssetsService } from './assets.service';
import { InspectionsService } from './inspections.service';
import { InspectionsCronService } from './inspections-cron.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EstateAccessModule, FilesModule, NotificationsModule],
  controllers: [
    EstateAssetsController,
    EstateInstallationsController,
    EstateInspectionTypesController,
    EstateInspectionsController,
    InspectionsController,
  ],
  providers: [AssetsService, InspectionsService, InspectionsCronService],
  exports: [AssetsService, InspectionsService],
})
export class InspectionsModule {}
