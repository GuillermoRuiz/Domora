import { Module } from '@nestjs/common';
import {
  DocumentFilesController,
  IssuePhotosController,
} from './files.controller';
import { StorageService } from './storage.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { RagAuthorizationModule } from '../assistant/rag-authorization.module';

@Module({
  imports: [EstateAccessModule, RagAuthorizationModule],
  controllers: [DocumentFilesController, IssuePhotosController],
  providers: [StorageService],
  exports: [StorageService],
})
export class FilesModule {}
