import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
export const USAGE_MAX_RANGE_DAYS = 366;

export interface UsageDay {
  day: string;
  activeUsers: number;
  activeB: number;
  activeC: number;
  requests: number;
}

export interface UsageModuleCount {
  module: string;
  /** Distinct users that used the module in the range. */
  users: number;
  /** Sum over days of the users that used it that day. */
  userDays: number;
}

export interface DespachoUsage {
  administratorId: string;
  /** Distinct role B users of the despacho active in the range. */
  activeUsers: number;
  /** Days with at least one active user of the despacho. */
  activeDays: number;
  requests: number;
  lastActiveDay: string;
  modules: { module: string; userDays: number }[];
}

export interface UsageSummary {
  from: string;
  to: string;
  days: UsageDay[];
  despachos: DespachoUsage[];
  modules: UsageModuleCount[];
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const byUseThenName = (
  a: { module: string; userDays: number },
  b: { module: string; userDays: number },
) => b.userDays - a.userDays || a.module.localeCompare(b.module);

/**
 * Reads the daily usage aggregation (S15) for the role A panel: active users
 * per day, per despacho and module adoption. Despacho figures cover role B
 * users (role C rows carry no despacho; they are resolved through estates by
 * the consumer when needed).
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * First day any usage was ever captured, or null. Consumers use it so a
   * short history (capture started with T4) is not read as inactivity.
   */
  async firstCapturedDay(): Promise<Date | null> {
    const { _min } = await this.prisma.userDailyActivity.aggregate({
      _min: { day: true },
    });
    return _min.day ?? null;
  }

  /**
   * Last UTC day (YYYY-MM-DD) any user of each despacho was active, over the
   * whole history. Despachos without usage are absent from the map.
   */
  async lastActiveDays(
    administratorIds: string[],
  ): Promise<Map<string, string>> {
    if (administratorIds.length === 0) return new Map();
    const rows = await this.prisma.userDailyActivity.groupBy({
      by: ['administratorId'],
      where: { administratorId: { in: administratorIds } },
      _max: { day: true },
    });
    const result = new Map<string, string>();
    for (const row of rows) {
      if (row.administratorId && row._max.day)
        result.set(row.administratorId, dayKey(row._max.day));
    }
    return result;
  }

  /** `from`/`to` are UTC days, both inclusive; at most 366 days. */
  async summary(from: Date, to: Date): Promise<UsageSummary> {
    const start = new Date(dayKey(from));
    const end = new Date(dayKey(to));
    const length = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (Number.isNaN(length) || length < 1 || length > USAGE_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango de uso debe ir de 1 a ${USAGE_MAX_RANGE_DAYS} días`,
      );
    }

    const rows = await this.prisma.userDailyActivity.findMany({
      where: { day: { gte: start, lte: end } },
      select: {
        day: true,
        userId: true,
        role: true,
        administratorId: true,
        modules: true,
        requests: true,
      },
    });

    const days = new Map<string, UsageDay>();
    for (let i = 0; i < length; i++) {
      const day = dayKey(new Date(start.getTime() + i * DAY_MS));
      days.set(day, {
        day,
        activeUsers: 0,
        activeB: 0,
        activeC: 0,
        requests: 0,
      });
    }
    const modules = new Map<string, { users: Set<string>; userDays: number }>();
    const despachos = new Map<
      string,
      {
        users: Set<string>;
        days: Set<string>;
        requests: number;
        modules: Map<string, number>;
      }
    >();

    for (const row of rows) {
      const day = dayKey(row.day);
      const totals = days.get(day);
      if (totals) {
        totals.activeUsers += 1;
        if (row.role === 'B') totals.activeB += 1;
        if (row.role === 'C') totals.activeC += 1;
        totals.requests += row.requests;
      }
      for (const module of row.modules) {
        const m = modules.get(module) ?? {
          users: new Set<string>(),
          userDays: 0,
        };
        m.users.add(row.userId);
        m.userDays += 1;
        modules.set(module, m);
      }
      if (row.administratorId) {
        const d = despachos.get(row.administratorId) ?? {
          users: new Set<string>(),
          days: new Set<string>(),
          requests: 0,
          modules: new Map<string, number>(),
        };
        d.users.add(row.userId);
        d.days.add(day);
        d.requests += row.requests;
        for (const module of row.modules)
          d.modules.set(module, (d.modules.get(module) ?? 0) + 1);
        despachos.set(row.administratorId, d);
      }
    }

    return {
      from: dayKey(start),
      to: dayKey(end),
      days: [...days.values()],
      despachos: [...despachos.entries()]
        .map(([administratorId, d]) => ({
          administratorId,
          activeUsers: d.users.size,
          activeDays: d.days.size,
          requests: d.requests,
          lastActiveDay: [...d.days].sort().at(-1)!,
          modules: [...d.modules.entries()]
            .map(([module, userDays]) => ({ module, userDays }))
            .sort(byUseThenName),
        }))
        .sort((a, b) => a.administratorId.localeCompare(b.administratorId)),
      modules: [...modules.entries()]
        .map(([module, m]) => ({
          module,
          users: m.users.size,
          userDays: m.userDays,
        }))
        .sort(byUseThenName),
    };
  }
}
