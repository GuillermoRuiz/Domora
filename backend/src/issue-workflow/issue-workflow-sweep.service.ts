import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { computeSituation } from './issue-situation';
import { IssueSituationService } from './issue-situation.service';
import { IssueWorkflowConfig } from './issue-workflow.config';
import {
  IssueWorkflowService,
  type OpenedTask,
} from './issue-workflow.service';

/** Nombre del cron del barrido: permite dejarlo activo cuando un entorno (local-preview) para el resto. */
export const ISSUE_SWEEP_CRON = 'domora-issue-sweep';

export interface SweepResult {
  /** Vencimientos de esperas atendidos (reclamar al tercero: recordatorio o tarea). */
  dueWaits: number;
  /** Visitas planificadas cuya hora pasó sin resultado: tareas nuevas de confirmar qué ocurrió. */
  overdueVisits: number;
  repaired: number;
  stalled: number;
}

/**
 * Garantiza que ninguna incidencia queda abierta sin siguiente paso. Corre en cualquier réplica y es idempotente:
 *  0. Las esperas vencidas (`IssueWait.dueAt`) abren una tarea de seguimiento.
 *  0b. Una visita planificada cuya hora pasó sin resultado abre UNA tarea de confirmar qué ocurrió (la pelota deja de
 *     estar en el proveedor).
 *  1. Se reparan las decisiones humanas que faltaban (`reconcile`).
 *  2. Una incidencia abierta sin tarea, espera ni visita, pasado `ISSUE_STALLED_GRACE_MINUTES` desde su
 *     última actuación, abre `review_issue / no_next_step`.
 */
@Injectable()
export class IssueWorkflowSweepService {
  private readonly logger = new Logger(IssueWorkflowSweepService.name);
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: IssueWorkflowService,
    private readonly situation: IssueSituationService,
    private readonly flow: IssueWorkflowConfig,
  ) {}

  @Cron('0 */10 * * * *', { name: ISSUE_SWEEP_CRON })
  async scheduled(): Promise<void> {
    if (!this.flow.sweepEnabled || this.busy) return;
    this.busy = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `Barrido de incidencias: ${error instanceof Error ? error.message : 'error'}`,
      );
    } finally {
      this.busy = false;
    }
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const dueWaits = await this.workflow.processDueWaits(now);
    const overdueVisits = await this.workflow.processOverdueVisits(
      now,
      this.flow.visitGraceMs,
    );
    const repaired = await this.workflow.reconcile(now);
    const stalled = await this.openStalledTasks(now);
    return { dueWaits, overdueVisits, repaired, stalled };
  }

  /** Abre la tarea de las incidencias estancadas. Devuelve cuántas tareas nuevas abrió. */
  async openStalledTasks(now: Date): Promise<number> {
    const options = {
      stalledGraceMs: this.flow.stalledGraceMs,
      visitGraceMs: this.flow.visitGraceMs,
    };
    const opened: OpenedTask[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.issue.findMany({
        where: {
          deletedAt: null,
          status: { in: ACTIVE_ISSUE_STATUSES },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;
      const facts = await this.situation.loadFacts(
        page.map((p) => p.id),
        now,
      );
      for (const f of facts.values()) {
        if (computeSituation(f, now, options) !== 'stalled') continue;
        try {
          const task = await this.prisma.$transaction((tx) =>
            this.workflow.openTask(tx, {
              issueId: f.issueId,
              kind: 'review_issue',
              payload: { reason: 'no_next_step' },
              discriminator: 'no_next_step',
              createdBy: 'system',
            }),
          );
          if (task.created) opened.push(task);
        } catch (error) {
          this.logger.warn(
            `no_next_step ${f.issueId}: ${error instanceof Error ? error.message : 'error'}`,
          );
        }
      }
      if (page.length < 500) break;
    }
    for (const task of opened) await this.workflow.notifyTaskOpened(task);
    return opened.length;
  }
}
