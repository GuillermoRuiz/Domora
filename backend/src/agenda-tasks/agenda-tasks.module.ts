import { Module } from '@nestjs/common';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgendaTasksController } from './agenda-tasks.controller';
import { AgendaTasksService } from './agenda-tasks.service';
import { AgendaTaskLinksService } from './agenda-task-links.service';
import { AgendaTaskExtrasService } from './agenda-task-extras.service';
import { AgendaTasksRemindersCronService } from './agenda-tasks-reminders-cron.service';
import { AgendaTaskKindRegistry } from './agenda-task-kind-registry.service';
import { AgendaTaskSystemService } from './agenda-task-system.service';
import { AgendaTaskResolutionService } from './agenda-task-resolution.service';

/**
 * Agenda de tareas de la gestora (sección "Tareas"). `AuditService` llega por
 * `GdprModule` (global). La agenda es trabajo que tiene que hacer una PERSONA.
 * Los módulos de dominio abren en ella tareas de DECISIÓN (aprobar un envío,
 * confirmar una cita…) con `AgendaTaskSystemService` y registran su tipo en
 * `AgendaTaskKindRegistry` (esquemas del payload y del resultado, y cómo se
 * ejecuta la decisión). `source`/`sourceRef` las hace idempotentes. Las
 * esperas y el trabajo de Domora NO son tareas: ver `IssueWorkflowModule`.
 */
@Module({
  imports: [EstateAccessModule, NotificationsModule, FilesModule],
  controllers: [AgendaTasksController],
  providers: [
    AgendaTasksService,
    AgendaTaskLinksService,
    AgendaTaskExtrasService,
    AgendaTasksRemindersCronService,
    AgendaTaskKindRegistry,
    AgendaTaskSystemService,
    AgendaTaskResolutionService,
  ],
  exports: [
    AgendaTasksService,
    AgendaTaskKindRegistry,
    AgendaTaskSystemService,
    AgendaTaskResolutionService,
  ],
})
export class AgendaTasksModule {}
