import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AiJob } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiQueueService, safeError } from './ai-queue.service';
import { AiConfigService } from './ai-config.service';
import { AiWorkerHeartbeatService } from './ai-worker-heartbeat.service';
import { isPermanentAiError } from './ai-errors';
import { AiBatchService } from './ai-batch.service';
import { InvoiceAiService } from './invoice-ai.service';
import { AccountingAiService } from './accounting-ai.service';
import { WeeklyAiService } from './weekly-ai.service';
import { madridWeekKey, WEEKLY_CRON, WEEKLY_TIME_ZONE } from './weekly-clock';
/** Nombre del cron que procesa la cola: permite dejarlo activo cuando un entorno (local-preview) para el resto. */
export const AI_WORKER_CRON = 'domora-ai-worker';
@Injectable()
export class AiWorkerService {
  private readonly logger = new Logger(AiWorkerService.name);
  private busy = false;
  /** Jobs reclamados por tick: antes era 1 (techo de ~4/min); con lease/heartbeat por job, procesarlos en paralelo es seguro. */
  private static readonly BATCH_SIZE = 8;
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AiQueueService,
    private readonly config: AiConfigService,
    private readonly batch: AiBatchService,
    private readonly invoices: InvoiceAiService,
    private readonly accounting: AccountingAiService,
    private readonly weekly: WeeklyAiService,
    /** Latido: dice a la proyección de las incidencias que hay un worker vivo atendiendo la cola. */
    private readonly heartbeat?: AiWorkerHeartbeatService,
  ) {}
  @Cron('*/15 * * * * *', { name: AI_WORKER_CRON }) async work() {
    if (!this.config.workerEnabled) return;
    // Latido ANTES de mirar si está ocupado: un worker procesando un job largo sigue vivo.
    await this.heartbeat?.beat();
    if (this.busy) return;
    this.busy = true;
    try {
      const jobs: AiJob[] = [];
      for (let i = 0; i < AiWorkerService.BATCH_SIZE; i++) {
        const job = await this.queue.claim(this.config.workerKinds);
        if (!job) break;
        jobs.push(job);
      }
      if (!jobs.length) return;
      await Promise.allSettled(jobs.map((job) => this.processJob(job)));
    } catch (error) {
      this.logger.warn(safeError(error));
    } finally {
      this.busy = false;
    }
  }
  private async processJob(job: AiJob): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.queue.heartbeat(job).catch(() => undefined);
    }, 30000);
    heartbeat.unref();
    try {
      if (
        !(await this.prisma.estate.count({
          where: {
            id: job.estateId,
            deletedAt: null,
            administrator: {
              deletedAt: null,
              status: { notIn: ['Vencida', 'Bloqueada'] },
            },
          },
        }))
      )
        throw new Error('AI_ESTATE_INACTIVE');
      if (job.kind === 'invoice') await this.invoices.process(job);
      else if (job.kind === 'accounting') await this.accounting.process(job);
      else if (job.kind === 'weekly') await this.weekly.process(job);
      else throw new Error('AI_JOB_KIND_INVALID');
      await this.queue.finish(job);
    } catch (error) {
      // Lo transitorio (429, 5xx, timeout, red) se reintenta; lo permanente no mejora con el tiempo y pasa a una persona ya.
      const permanent = isPermanentAiError(error);
      await this.queue.finish(job, error, { permanent });
      this.logger.warn(`Job ${job.id}: ${safeError(error)}`);
    } finally {
      clearInterval(heartbeat);
    }
  }
  /** The advisory transaction only coordinates replicas. Feature writes use their own short transactions. */
  private async coordinated(name: string, work: () => Promise<void>) {
    if (!this.config.workerEnabled) return;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const lock = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked`;
          if (lock[0]?.locked) await work();
        },
        { timeout: 240000 },
      );
    } catch (error) {
      this.logger.warn(safeError(error));
    }
  }
  @Cron('0 * * * * *') async submitBatch() {
    await this.coordinated('domora.ai.batch.submit', () => this.batch.submit());
  }
  @Cron('30 * * * * *') async pollBatch() {
    await this.coordinated('domora.ai.batch.poll', () => this.batch.poll());
  }
  @Cron(WEEKLY_CRON, { timeZone: WEEKLY_TIME_ZONE }) async scheduledWeekly() {
    await this.scheduleWeekly();
  }
  @Cron('0 */10 * * * *') async recover() {
    if (!this.config.workerEnabled) return;
    await this.prisma.aiJob.updateMany({
      where: {
        status: 'running',
        attempts: { gte: 5 },
        leaseUntil: { lt: new Date() },
      },
      data: {
        status: 'failed',
        lastError: 'AI_LEASE_EXHAUSTED',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const docs = await this.prisma.aiInvoiceDocument.findMany({
      where: { status: 'pending' },
      take: 100,
    });
    for (const doc of docs)
      await this.queue.enqueue(doc.estateId, 'invoice', doc.id);
    // Lo que ya no hace falta (ficheros de Batch en OpenAI, prompts de peticiones completadas).
    await this.batch
      .cleanup()
      .catch((e: unknown) => this.logger.warn(safeError(e)));
    await this.scheduleWeekly();
  }
  private async scheduleWeekly() {
    if (!this.config.workerEnabled || !this.config.enabled) return;
    const week = madridWeekKey(new Date());
    let cursor: string | undefined;
    while (true) {
      const estates = await this.prisma.estate.findMany({
        where: {
          deletedAt: null,
          administrator: {
            deletedAt: null,
            status: { notIn: ['Vencida', 'Bloqueada'] },
          },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const e of estates)
        await this.queue.enqueue(
          e.id,
          'weekly',
          e.id,
          `weekly:${e.id}:${week}`,
        );
      if (estates.length < 100) break;
      cursor = estates[estates.length - 1].id;
    }
  }
  @Cron('0 15 * * * *') async scheduleAccounting() {
    if (!this.config.workerEnabled) return;
    const hour = new Date().toISOString().slice(0, 13);
    const banks = await this.prisma.bankAccount.findMany({
      where: {
        estate: {
          deletedAt: null,
          administrator: {
            deletedAt: null,
            status: { notIn: ['Vencida', 'Bloqueada'] },
          },
        },
      },
      select: { id: true, estateId: true },
    });
    for (const b of banks)
      await this.queue.enqueue(
        b.estateId,
        'accounting',
        b.id,
        `accounting:${b.estateId}:${b.id}:${hour}`,
      );
  }
}
