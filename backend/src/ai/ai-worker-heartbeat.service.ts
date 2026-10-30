import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from './ai-config.service';

/** Qué tipos de job tienen un worker vivo que los atienda ahora mismo. */
export interface WorkerCoverage {
  /** Hay al menos un worker sano que atiende TODOS los tipos. */
  all: boolean;
  kinds: ReadonlySet<string>;
}

export const coverageServes = (
  coverage: WorkerCoverage,
  kind: string,
): boolean => coverage.all || coverage.kinds.has(kind);

const HOUSEKEEPING_EVERY_MS = 60 * 60_000;
const FORGET_AFTER_MS = 24 * 3_600_000;

/**
 * Latido del worker de IA. Un timestamp compartido en la base de datos (sin infraestructura nueva) que dice si hay
 * alguien atendiendo la cola. Sirve SOLO para representar bien la situación y detectar antes una caída; el margen de
 * los jobs huérfanos sigue protegiendo de lo que el latido no vea. No tiene relación con el entitlement: una gestora
 * Los módulos que no usan IA simplemente no crean jobs.
 */
@Injectable()
export class AiWorkerHeartbeatService implements OnModuleDestroy {
  private readonly logger = new Logger(AiWorkerHeartbeatService.name);
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly startedAt = new Date();
  private lastBeatAt = 0;
  private lastHousekeepingAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AiConfigService,
  ) {}

  /**
   * Escribe el latido de este proceso, como mucho una vez por intervalo (se puede llamar en cada tick del worker).
   * Nunca lanza: un fallo de la base de datos no debe parar la cola.
   */
  async beat(now: Date = new Date()): Promise<void> {
    if (now.getTime() - this.lastBeatAt < this.config.workerHeartbeatIntervalMs)
      return;
    this.lastBeatAt = now.getTime();
    const kinds = this.config.workerKinds ?? [];
    try {
      await this.prisma.aiWorkerHeartbeat.upsert({
        where: { instanceId: this.instanceId },
        create: {
          instanceId: this.instanceId,
          kinds,
          startedAt: this.startedAt,
          beatAt: now,
        },
        update: { kinds, beatAt: now },
      });
      if (now.getTime() - this.lastHousekeepingAt >= HOUSEKEEPING_EVERY_MS) {
        this.lastHousekeepingAt = now.getTime();
        await this.prisma.aiWorkerHeartbeat.deleteMany({
          where: { beatAt: { lt: new Date(now.getTime() - FORGET_AFTER_MS) } },
        });
      }
    } catch (error) {
      this.lastBeatAt = 0;
      this.logger.warn(
        `No se pudo escribir el latido del worker: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  /** Qué cubren los workers con latido reciente. */
  async coverage(now: Date = new Date()): Promise<WorkerCoverage> {
    const rows = await this.prisma.aiWorkerHeartbeat.findMany({
      where: {
        beatAt: {
          gte: new Date(now.getTime() - this.config.workerHeartbeatStaleMs),
        },
      },
      select: { kinds: true },
    });
    const kinds = new Set<string>();
    let all = false;
    for (const row of rows) {
      if (row.kinds.length === 0) all = true;
      for (const kind of row.kinds) kinds.add(kind);
    }
    return { all, kinds };
  }

  /** Una parada ordenada se nota al instante en vez de al caducar el latido. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.prisma.aiWorkerHeartbeat.deleteMany({
        where: { instanceId: this.instanceId },
      });
    } catch {
      // El módulo se está cerrando: si la conexión ya no está, el latido caducará solo.
    }
  }
}
