import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RagAuthorizationModule } from '../assistant/rag-authorization.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { DocumentAccessService } from './document-access.service';
import { OwnerDocumentsController } from './owner-documents.controller';
import { OwnerDocumentsService } from './owner-documents.service';

/** Estate document library (odd/tasks/documentos-finca.md). */
@Module({
  imports: [
    FilesModule,
    RagAuthorizationModule,
    EstateAccessModule,
    NotificationsModule,
  ],
  controllers: [LibraryController, OwnerDocumentsController],
  providers: [LibraryService, DocumentAccessService, OwnerDocumentsService],
  exports: [LibraryService, DocumentAccessService],
})
export class DocumentsModule {}
