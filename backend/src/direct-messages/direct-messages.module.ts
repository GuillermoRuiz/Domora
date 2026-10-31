import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DirectMessageAttachmentsController } from './direct-message-attachments.controller';
import { DirectMessageAttachmentsService } from './direct-message-attachments.service';
import { DirectMessageEditsService } from './direct-message-edits.service';
import { DirectMessagesController } from './direct-messages.controller';
import { DirectMessagesService } from './direct-messages.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule, FilesModule],
  controllers: [DirectMessagesController, DirectMessageAttachmentsController],
  providers: [
    DirectMessagesService,
    DirectMessageAttachmentsService,
    DirectMessageEditsService,
  ],
  exports: [DirectMessagesService],
})
export class DirectMessagesModule {}
