import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { CommunityFinanceService } from './community-finance.service';
import { RagAuthorizationModule } from './rag-authorization.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule, RagAuthorizationModule],
  controllers: [AssistantController],
  providers: [AssistantService, CommunityFinanceService],
})
export class AssistantModule {}
