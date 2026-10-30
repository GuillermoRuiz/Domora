import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type AiJob } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export const safeError = (e: unknown): string =>
  e instanceof Error && /^[A-Z][A-Z0-9_:.-]{0,99}$/.test(e.message)
    ? e.message
    : 'AI_PROCESSING_FAILED';
@Injectable()
export class AiQueueService {
  constructor(private readonly prisma: PrismaService) {}
  async enqueue(
    estateId: string,
    kind: string,
    entityId: string,
    key = `${kind}:${estateId}:${entityId}`,
  ) {
    return this.prisma.aiJob.upsert({
      where: { dedupeKey: key },
      create: {
        estateId,
        kind,
        entityId,
        dedupeKey: key,
      },
      update: {},
    });
  }
  /** `kinds`: si se indica, solo se reclaman trabajos de esos tipos (un entorno puede limitar qué procesa). */
  async claim(kinds?: string[]): Promise<AiJob | null> {
    const now = new Date();
    const candidate = await this.prisma.aiJob.findFirst({
      where: {
        ...(kinds ? { kind: { in: kinds } } : {}),
        attempts: { lt: 5 },
        OR: [
          { status: 'pending', availableAt: { lte: now } },
          { status: 'running', leaseUntil: { lt: now } },
        ],
      },
      orderBy: { availableAt: 'asc' },
    });
    if (!candidate) return null;
    const token = randomUUID();
    const changed = await this.prisma.aiJob.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        leaseToken: candidate.leaseToken,
        attempts: candidate.attempts,
      },
      data: {
        status: 'running',
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 300000),
        attempts: { increment: 1 },
      },
    });
    return changed.count
      ? this.prisma.aiJob.findUnique({ where: { id: candidate.id } })
      : null;
  }
  async fenced<T>(
    job: AiJob,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.aiJob.updateMany({
        where: {
          id: job.id,
          status: 'running',
          leaseToken: job.leaseToken,
          leaseUntil: { gt: new Date() },
        },
        data: { leaseUntil: new Date(Date.now() + 300000) },
      });
      if (lock.count !== 1) throw new Error('AI_LEASE_LOST');
      return work(tx);
    });
  }
  async heartbeat(job: AiJob) {
    return this.prisma.aiJob.updateMany({
      where: {
        id: job.id,
        status: 'running',
        leaseToken: job.leaseToken,
        leaseUntil: { gt: new Date() },
      },
      data: { leaseUntil: new Date(Date.now() + 300000) },
    });
  }
  /**
   * `permanent`: el error no mejora reintentando (IA desactivada, sin configurar, región no disponible,
   * salida inválida…): el job queda `failed` de inmediato en lugar de agotar los reintentos.
   */
  async finish(
    job: AiJob,
    error?: unknown,
    options: { permanent?: boolean } = {},
  ) {
    const failed = error !== undefined;
    await this.prisma.aiJob.updateMany({
      where: { id: job.id, status: 'running', leaseToken: job.leaseToken },
      data: {
        status: failed
          ? options.permanent || job.attempts >= 5
            ? 'failed'
            : 'pending'
          : 'completed',
        leaseUntil: null,
        leaseToken: null,
        lastError: failed ? safeError(error) : null,
        availableAt: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
        ),
      },
    });
  }
}
