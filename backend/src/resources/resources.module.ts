import { Module } from '@nestjs/common';
import {
  ActivityController,
  AlertsController,
  CommunicationAttachmentsController,
  CommunicationsController,
  EstateCommunicationsController,
  EstateDocumentsController,
  ResourceReadsController,
} from './resources.controller';
import { ResourcesService } from './resources.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RagAuthorizationModule } from '../assistant/rag-authorization.module';

@Module({
  imports: [
    EstateAccessModule,
    FilesModule,
    NotificationsModule,
    RagAuthorizationModule,
  ],
  controllers: [
    EstateCommunicationsController,
    CommunicationsController,
    CommunicationAttachmentsController,
    EstateDocumentsController,
    ResourceReadsController,
    AlertsController,
    ActivityController,
  ],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
