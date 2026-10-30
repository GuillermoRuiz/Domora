import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { UserRole } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UsageHit {
  userId: string;
  role: UserRole;
  administratorId: string | null;
  module: string;
  at?: Date;
}

export interface UsageRecorderOptions {
  /** Distinct user-days kept in memory between flushes. */
  maxEntries?: number;
  flushIntervalMs?: number;
}

export const USAGE_RECORDER_OPTIONS = Symbol('USAGE_RECORDER_OPTIONS');

interface Entry {
  day: string;
  userId: string;
  role: UserRole;
  administratorId: string | null;
  modules: Set<string>;
  requests: number;
}

/**
 * Daily usage aggregation (S15). Requests are counted in memory per user and
 * UTC day and written once per flush (every minute and on shutdown) with one
 * upsert per user-day that adds the requests and unions the modules, so the
 * table grows with active users × days, never with traffic.
 *
 * Bounded: at most `maxEntries` user-days wait in memory; beyond that new
 * user-days are dropped until the next flush (known ones keep counting). A
 * failed upsert is logged and dropped — usage is best-effort and must never
 * break or slow a request. Usage of a user that no longer exists or has
 * erased the account (soft-deleted, `deleted_at` set) is skipped in the
 * statement itself, so a hit buffered on any replica before a GDPR erasure
 * never re-creates rows after it. Multiple API replicas each flush their own buffer;
 * the upsert merges them.
 */
@Injectable()
export class UsageRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageRecorder.name);
  private readonly maxEntries: number;
  private readonly flushIntervalMs: number;
  private buffer = new Map<string, Entry>();
  private overflowWarned = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(USAGE_RECORDER_OPTIONS) options: UsageRecorderOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  record(hit: UsageHit): void {
    const day = (hit.at ?? new Date()).toISOString().slice(0, 10);
    const key = `${day}|${hit.userId}`;
    let entry = this.buffer.get(key);
    if (!entry) {
      if (this.buffer.size >= this.maxEntries) {
        if (!this.overflowWarned) {
          this.overflowWarned = true;
          this.logger.warn(`Usage buffer full (${this.maxEntries} user-days); dropping new ones until the next flush`);
        }
        return;
      }
      entry = { day, userId: hit.userId, role: hit.role, administratorId: hit.administratorId, modules: new Set(), requests: 0 };
      this.buffer.set(key, entry);
    }
    entry.modules.add(hit.module);
    entry.requests += 1;
  }

  /** Writes and empties the buffer. Never throws. `written` counts user-days actually stored. */
  async flush(): Promise<{ written: number; failed: number }> {
    const entries = [...this.buffer.values()];
    // Swap before awaiting: requests arriving during the flush go to a fresh buffer.
    this.buffer = new Map();
    this.overflowWarned = false;
    let written = 0;
    let failed = 0;
    for (const entry of entries) {
      try {
        // 0 rows: the user was erased or deleted meanwhile — nothing is written.
        if ((await this.upsert(entry)) > 0) written += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Could not save usage for ${entry.day}`, error as Error);
      }
    }
    return { written, failed };
  }

  private upsert(e: Entry): Promise<number> {
    const modules = [...e.modules].sort();
    return this.prisma.$executeRaw`
      INSERT INTO user_daily_activity (day, user_id, role, administrator_id, modules, requests, created_at, updated_at)
      SELECT ${e.day}::date, ${e.userId}::uuid, ${e.role}::"UserRole", ${e.administratorId}::uuid, ${modules}::text[], ${e.requests}, now(), now()
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ${e.userId}::uuid AND deleted_at IS NULL)
      ON CONFLICT (day, user_id) DO UPDATE SET
        modules = ARRAY(SELECT DISTINCT m FROM unnest(user_daily_activity.modules || EXCLUDED.modules) AS m ORDER BY m),
        requests = user_daily_activity.requests + EXCLUDED.requests,
        updated_at = now()`;
  }
}
