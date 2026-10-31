import { Module } from '@nestjs/common';
import { EstateIssuesController, IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { IssueInteractionsService } from './issue-interactions.service';
import { OwnerIssuesController } from './owner-issues.controller';
import { OwnerIssuesService } from './owner-issues.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiCoreModule } from '../ai/ai-core.module';
import { IssueWorkflowModule } from '../issue-workflow/issue-workflow.module';
import { AgendaTasksModule } from '../agenda-tasks/agenda-tasks.module';

@Module({
  imports: [
    EstateAccessModule,
    NotificationsModule,
    AiCoreModule,
    IssueWorkflowModule,
    AgendaTasksModule,
  ],
  controllers: [
    EstateIssuesController,
    IssuesController,
    OwnerIssuesController,
  ],
  providers: [IssuesService, IssueInteractionsService, OwnerIssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
