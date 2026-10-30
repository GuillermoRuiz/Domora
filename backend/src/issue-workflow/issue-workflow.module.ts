import { Module } from '@nestjs/common';
import { AgendaTasksModule } from '../agenda-tasks/agenda-tasks.module';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IssueEventsService } from './issue-events.service';
import { IssueWorkflowConfig } from './issue-workflow.config';
import { IssueWorkflowSweepService } from './issue-workflow-sweep.service';
import { IssueSituationController } from './issue-situation.controller';
import { IssueSituationService } from './issue-situation.service';
import { IssueJourneyService } from './issue-journey.service';
import { IssueWorkflowService } from './issue-workflow.service';
import { InsuranceClaimsService } from './insurance-claims.service';
import { IssueWorkflowTaskKinds } from './issue-workflow-task-kinds.service';

/**
 * Workflow de la incidencia. Reparto de responsabilidades:
 *  - `AgendaTask`  → trabajo que tiene que hacer una PERSONA (decisiones).
 *  - Relojes       → `IssueWait.dueAt` lo atiende el barrido de incidencias, no un job de IA.
 *  - `IssueWait`   → lo que espera el expediente de un tercero.
 *  - `IssueTimelineEntry` → lo que ocurrió (eventos, con su autor).
 * Aquí viven los servicios que unen esas piezas sin mezclarlas: el escritor de
 * eventos, la orquestación (tareas, esperas, visitas) y la proyección de la
 * situación.
 */
@Module({
  imports: [
    AgendaTasksModule,
    EstateAccessModule,
    NotificationsModule,
  ],
  controllers: [IssueSituationController],
  providers: [
    IssueWorkflowConfig,
    IssueWorkflowSweepService,
    IssueEventsService,
    IssueWorkflowService,
    InsuranceClaimsService,
    IssueSituationService,
    IssueJourneyService,
    IssueWorkflowTaskKinds,
  ],
  exports: [
    IssueWorkflowConfig,
    IssueEventsService,
    IssueWorkflowService,
    InsuranceClaimsService,
    IssueSituationService,
  ],
})
export class IssueWorkflowModule {}
