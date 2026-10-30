import { Module } from '@nestjs/common';
import { RagAuthorizationService } from './rag-authorization.service';
import { PrismaModule } from '../prisma/prisma.module';

/** Document authorization is independent of RAG/storage/provider configuration. */
@Module({
  imports: [PrismaModule],
  providers: [RagAuthorizationService],
  exports: [RagAuthorizationService],
})
export class RagAuthorizationModule {}
