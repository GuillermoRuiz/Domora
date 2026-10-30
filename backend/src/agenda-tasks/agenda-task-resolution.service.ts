import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { AgendaTask } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../gdpr/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OPEN_STATUSES, isTerminal } from './agenda-task.constants';
import { AgendaTaskKindRegistry } from './agenda-task-kind-registry.service';
import { RESOLVING_OUTCOME } from './agenda-task-kind.types';
import { AgendaTasksService } from './agenda-tasks.service';
import type { AgendaTaskDetail } from './agenda-task.types';

/** Pasado este tiempo, una resolución "en curso" se da por abandonada (el proceso murió) y se puede reintentar. */
const STALE_RESOLVING_MS = 5 * 60_000;

/**
 * Resolución de una tarea de decisión: valida lo que envía la persona contra
 * el esquema de su tipo, ejecuta la decisión (la implementa quien registró el
 * tipo) y cierra la tarea con su `outcome` y `resultRef`. Es la ÚNICA forma de
 * cerrar una tarea con `kind`: marcarla como hecha a secas no ejecutaría nada.
 */
@Injectable()
export class AgendaTaskResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: AgendaTasksService,
    private readonly registry: AgendaTaskKindRegistry,
    private readonly audit: AuditService,
  ) {}

  async resolve(
    id: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const task = await this.tasks.assertAccess(id, user);
    await this.execute(task, body, user);
    return this.tasks.getById(id, user);
  }

  /**
   * La MISMA resolución, pedida desde la ficha de la incidencia. Es el camino de quien gestiona incidencias sin tener agenda
   * (soporte, rol A): la autorización es la de la incidencia (quien llama ya comprobó que la ve, `assertIssueAccess`) y la
   * tarea tiene que ser de ESA incidencia; el resto —validación, cerrojo, ejecución, rastro— es el de siempre.
   */
  async resolveForIssue(
    issueId: string,
    taskId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<{
    id: string;
    status: string;
    outcome: string | null;
    resultRef: unknown;
  }> {
    const task = await this.prisma.agendaTask.findFirst({
      where: { id: taskId, issueId, archivedAt: null },
    });
    if (!task) throw new NotFoundException('Tarea no encontrada.');
    await this.execute(task, body, user);
    const done = await this.prisma.agendaTask.findUniqueOrThrow({
      where: { id: taskId },
      select: { id: true, status: true, outcome: true, resultRef: true },
    });
    return done;
  }

  private async execute(
    task: AgendaTask,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<void> {
    const id = task.id;
    if (!task.kind || !task.issueId || !task.estateId) {
      throw new BadRequestException('Esta tarea no es una decisión.');
    }
    if (isTerminal(task.status)) {
      throw new ConflictException('Esta decisión ya está resuelta.');
    }
    const definition = this.registry.get(task.kind);
    if (!definition.resolve) {
      throw new NotImplementedException(
        'Este tipo de tarea todavía no se puede resolver desde la API.',
      );
    }
    const resolution = this.registry.validateResolution(task.kind, body);
    const payload = this.registry.validatePayload(task.kind, task.payload);

    // Cerrojo: dos personas no resuelven la misma decisión a la vez (ni se ejecuta dos veces).
    const claimed = await this.prisma.agendaTask.updateMany({
      where: {
        id,
        status: { in: OPEN_STATUSES },
        OR: [
          { outcome: null },
          {
            outcome: RESOLVING_OUTCOME,
            updatedAt: { lt: new Date(Date.now() - STALE_RESOLVING_MS) },
          },
        ],
      },
      data: { outcome: RESOLVING_OUTCOME },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Esta decisión ya se está resolviendo.');
    }

    let result;
    try {
      result = await definition.resolve({
        task: {
          id: task.id,
          kind: task.kind,
          issueId: task.issueId,
          estateId: task.estateId,
          administratorId: task.administratorId,
        },
        payload,
        resolution,
        user,
      });
    } catch (error) {
      await this.prisma.agendaTask.updateMany({
        where: { id, outcome: RESOLVING_OUTCOME },
        data: { outcome: null },
      });
      throw error;
    }

    const resultRef = this.registry.validateResultRef(
      task.kind,
      result.resultRef,
    );
    await this.prisma.agendaTask.update({
      where: { id },
      data: {
        status: 'COMPLETADA',
        outcome: result.outcome,
        resultRef: resultRef,
        completedAt: new Date(),
        cancelledAt: null,
        statusBeforeCompletion: task.status,
      },
    });
    await this.audit.logAccess(
      user,
      'agenda_task',
      'resolve',
      id,
      `${task.kind}:${result.outcome}`.slice(0, 255),
    );
  }
}
