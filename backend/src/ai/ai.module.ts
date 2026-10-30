import { Module } from '@nestjs/common';
import { AiCoreModule } from './ai-core.module';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgendaTasksModule } from '../agenda-tasks/agenda-tasks.module';
import { AiAccessService } from './ai-access.service';
import { InvoiceAiService } from './invoice-ai.service';
import { AccountingAiService } from './accounting-ai.service';
import { WeeklyAiService } from './weekly-ai.service';
import { AiResultsService } from './ai-results.service';
import { AiBatchService } from './ai-batch.service';
import { AiWorkerService } from './ai-worker.service';
import { EstateAiController } from './ai.controller';
@Module({
  imports: [
    AiCoreModule,
    EstateAccessModule,
    FilesModule,
    NotificationsModule,
    AgendaTasksModule,
  ],
  providers: [
    AiAccessService,
    InvoiceAiService,
    AccountingAiService,
    WeeklyAiService,
    AiResultsService,
    AiBatchService,
    AiWorkerService,
    
  ],
  controllers: [EstateAiController],
})
export class AiModule {}
