import { DocumentsModule } from '../documents/documents.module';
import { Module } from '@nestjs/common';
import {
  EstateMeetingsController,
  MeetingAttachmentsController,
  MeetingsController,
} from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingQuorumService } from './meeting-quorum.service';
import { MeetingEligibilityService } from './meeting-eligibility.service';
import { ConvocatoriaDocxService } from './convocatoria-docx.service';
import { ActaDocxService } from './acta-docx.service';
import { MeetingsNotificationsCronService } from './meetings-notifications-cron.service';
import { ActaController } from './acta/acta.controller';
import { ActaService } from './acta/acta.service';
import { ActaSnapshotService } from './acta/acta-snapshot.service';
import { ActaNarrativeService } from './acta/acta-narrative.service';
import { ActaPdfService } from './acta/acta-pdf.service';
import { AiCoreModule } from '../ai/ai-core.module';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    EstateAccessModule,
    FilesModule,
    MailModule,
    NotificationsModule,
    AiCoreModule,
    DocumentsModule,
  ],
  controllers: [
    EstateMeetingsController,
    MeetingsController,
    MeetingAttachmentsController,
    ActaController,
  ],
  providers: [
    MeetingsService,
    MeetingQuorumService,
    ConvocatoriaDocxService,
    ActaDocxService,
    MeetingEligibilityService,
    MeetingsNotificationsCronService,
    ActaService,
    ActaSnapshotService,
    ActaNarrativeService,
    ActaPdfService,
  ],
  exports: [MeetingsService, MeetingEligibilityService, ActaPdfService],
})
export class MeetingsModule {}
