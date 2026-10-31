import { Injectable } from '@nestjs/common';
import {
  type AgendaTask,
  type AgendaTaskPriority,
  type TaskCreatorKind,
} from '../prisma/client';
import { OPEN_STATUSES } from './agenda-task.constants';
import { assertTeamAssignee } from './agenda-task-assignee';
import { AgendaTaskKindRegistry } from './agenda-task-kind-registry.service';
import type { TaskDb, TaskOutcome } from './agenda-task-kind.types';

/** Valor de `AgendaTask.source` de las tareas que abre el workflow de incidencias. */
export const ISSUE_TASK_SOURCE = 'issue';

/** Duración de una tarea con fecha y hora fijadas por una persona (un recordatorio). */
export const FIXED_DUE_TASK_MINUTES = 30;

/** Plazo (horas desde que se abre) que se da a una persona para actuar, según prioridad: la tarea queda colocada en ese momento. */
export const TASK_DEADLINE_HOURS: Record<AgendaTaskPriority, number> = {
  URGENTE: 2,
  ALTA: 24,
  MEDIA: 72,
  BAJA: 168,
};

export interface OpenSystemTaskInput {
  administratorId: string;
  estateId: string;
  issueId: string;
  kind: string;
  /** Se valida contra el esquema `payload` del tipo. */
  payload: unknown;
  title: string;
  description?: string;
  priority: AgendaTaskPriority;
  createdByKind: Exclude<TaskCreatorKind, 'person'>;
  /** Responsable (de su equipo, misma regla que una tarea manual). Sin él, la tarea queda sin asignar. */
  assignedToUserId?: string;
  /**
   * Distingue dos tareas legítimas del mismo tipo en la misma incidencia
   * (p. ej. el mensaje al que se refiere). Misma clave = misma tarea.
   */
  discriminator?: string;
  /**
   * Cuándo toca: la tarea empieza en ese momento (y dura `FIXED_DUE_TASK_MINUTES`), de modo que la agenda la muestra a esa
   * hora. Sin él, empieza ahora y vence según el plazo de su prioridad.
   */
  dueAt?: Date;
  now?: Date;
}

export interface OpenedSystemTask {
  task: AgendaTask;
  /** `false` si ya había una tarea abierta igual: abrirla dos veces no hace nada. */
  created: boolean;
}

export interface CloseSystemTaskInput {
  status: 'COMPLETADA' | 'CANCELADA';
  outcome: TaskOutcome;
  resultRef?: unknown;
  now?: Date;
}

/**
 * Altas y cierres de tareas por parte del sistema (Domora). La agenda sigue
 * siendo trabajo HUMANO: aquí solo se abren tareas cuando una persona tiene
 * que decidir algo, y se cierran cuando esa decisión deja de hacer falta.
 * Idempotente: la clave (`source`, `sourceRef`) es única por gestora.
 */
@Injectable()
export class AgendaTaskSystemService {
  constructor(private readonly registry: AgendaTaskKindRegistry) {}

  private sourceRefFor(input: {
    issueId: string;
    kind: string;
    discriminator?: string;
  }): string {
    return `${input.issueId}:${input.kind}${input.discriminator ? `:${input.discriminator}` : ''}`;
  }

  async open(
    db: TaskDb,
    input: OpenSystemTaskInput,
  ): Promise<OpenedSystemTask> {
    const payload = this.registry.validatePayload(input.kind, input.payload);
    if (input.assignedToUserId)
      await assertTeamAssignee(
        db,
        input.administratorId,
        input.assignedToUserId,
      );
    const now = input.now ?? new Date();
    const base = this.sourceRefFor(input);

    // Una tarea ya resuelta no se reabre: si la misma decisión vuelve a hacer falta, es otra tarea (`#2`…).
    for (let attempt = 1; attempt < 100; attempt++) {
      const sourceRef = attempt === 1 ? base : `${base}#${attempt}`;
      const existing = await db.agendaTask.findFirst({
        where: {
          administratorId: input.administratorId,
          source: ISSUE_TASK_SOURCE,
          sourceRef,
        },
      });
      if (existing && OPEN_STATUSES.includes(existing.status)) {
        return { task: existing, created: false };
      }
      if (existing) continue;
      const startAt =
        input.dueAt ??
        new Date(
          now.getTime() + TASK_DEADLINE_HOURS[input.priority] * 3_600_000,
        );
      const task = await db.agendaTask.create({
        data: {
          administratorId: input.administratorId,
          estateId: input.estateId,
          issueId: input.issueId,
          title: input.title.slice(0, 200),
          description: input.description ?? null,
          type: 'INCIDENCIA',
          priority: input.priority,
          assignedToUserId: input.assignedToUserId ?? null,
          status: 'PENDIENTE',
          startAt,
          endAt: new Date(startAt.getTime() + FIXED_DUE_TASK_MINUTES * 60_000),
          // El plazo es la fecha límite del SLA; el bloque de 30 min del calendario es solo cómo se ve. Arrastrarlo no lo cambia.
          dueAt: startAt,
          allDay: false,
          // Un paso de la incidencia no ocupa tiempo: en el calendario es una nota del día de su plazo.
          noDuration: true,
          source: ISSUE_TASK_SOURCE,
          sourceRef,
          kind: input.kind,
          payload: payload,
          createdByKind: input.createdByKind,
          createdByUserId: null,
          // Para que el cajón de la tarea enseñe la incidencia con el vínculo de siempre.
          links: { create: [{ entityType: 'issue', entityId: input.issueId }] },
        },
      });
      return { task, created: true };
    }
    throw new Error('AGENDA_TASK_REOPEN_LIMIT');
  }

  /** Tareas de decisión abiertas de una incidencia (opcionalmente solo de un tipo). */
  openFor(db: TaskDb, issueId: string, kind?: string) {
    return db.agendaTask.findMany({
      where: {
        issueId,
        status: { in: OPEN_STATUSES },
        kind: kind ?? { not: null },
      },
    });
  }

  /**
   * Cierra tareas abiertas. Devuelve solo las que ha cerrado esta llamada:
   * si otra se adelantó (otra persona, otro proceso), no se cuentan.
   */
  async close(
    db: TaskDb,
    tasks: Pick<AgendaTask, 'id' | 'kind'>[],
    input: CloseSystemTaskInput,
  ): Promise<string[]> {
    const now = input.now ?? new Date();
    const closed: string[] = [];
    for (const task of tasks) {
      const resultRef =
        input.resultRef === undefined || input.outcome === 'superseded'
          ? undefined
          : task.kind
            ? this.registry.validateResultRef(task.kind, input.resultRef)
            : undefined;
      const changed = await db.agendaTask.updateMany({
        where: { id: task.id, status: { in: OPEN_STATUSES } },
        data: {
          status: input.status,
          outcome: input.outcome,
          resultRef: resultRef,
          completedAt: input.status === 'COMPLETADA' ? now : null,
          cancelledAt: input.status === 'CANCELADA' ? now : null,
        },
      });
      if (changed.count === 1) closed.push(task.id);
    }
    return closed;
  }
}
