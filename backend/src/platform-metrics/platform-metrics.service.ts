import { Injectable } from '@nestjs/common';
import { AdminActivityType, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mrrContribution,
  mrrMovements,
  type MrrClient,
  type MrrMovements,
} from './mrr';

/** Months the MRR series looks back, the current one included. */
const SERIES_MONTHS = 12;
/** Activity that matters to Domora as a SaaS vendor (S11): not logins, messages or every invoice. */
const BUSINESS_EVENTS: AdminActivityType[] = [
  AdminActivityType.signup,
  AdminActivityType.plan_change,
  AdminActivityType.payment_received,
  AdminActivityType.cancellation_requested,
  AdminActivityType.onboarding_completed,
];
const MAX_ACTIVITY = 50;

export interface BusinessEvent {
  id: string;
  type: AdminActivityType;
  title: string;
  occurredAt: Date;
  administrator: { id: string; name: string };
}

export interface MrrMonth {
  /** `YYYY-MM`. */
  month: string;
  mrr: number;
  payingClients: number;
  movements: MrrMovements;
}

export interface MrrOverview {
  currentMrr: number;
  payingClients: number;
  /** First month with captured data (`YYYY-MM`): there is no history before it. */
  dataSince: string;
  months: MrrMonth[];
}

/**
 * Platform MRR for the role A panel (odd/tasks/role-a-panel.md S9): the live
 * figure comes from the clients' current state, the history from the monthly
 * snapshots, which only exist from the day they started being captured.
 */
@Injectable()
export class PlatformMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rewrites the current month's snapshot with every paying client's MRR. Idempotent: run daily, the month closes with its last value. */
  async captureCurrentMonth(today = new Date()): Promise<void> {
    const month = startOfMonth(today);
    const paying = await this.liveContributions(today);
    await this.prisma.$transaction([
      ...[...paying].map(([administratorId, value]) => {
        const mrr = new Prisma.Decimal(value);
        return this.prisma.clientMrrSnapshot.upsert({
          where: { month_administratorId: { month, administratorId } },
          update: { mrr },
          create: { month, administratorId, mrr },
        });
      }),
      this.prisma.clientMrrSnapshot.deleteMany({
        where: { month, administratorId: { notIn: [...paying.keys()] } },
      }),
    ]);
  }

  async mrrOverview(today = new Date()): Promise<MrrOverview> {
    const current = startOfMonth(today);
    const windowStart = addMonths(current, -(SERIES_MONTHS - 1));
    // The month before the window is the baseline the first shown month is diffed against.
    const baseline = addMonths(windowStart, -1);
    const [live, rows, earliest, paidBefore] = await Promise.all([
      this.liveContributions(today),
      this.prisma.clientMrrSnapshot.findMany({
        where: { month: { gte: baseline, lt: current } },
        select: { month: true, administratorId: true, mrr: true },
        orderBy: { month: 'asc' },
      }),
      this.prisma.clientMrrSnapshot.aggregate({ _min: { month: true } }),
      this.prisma.clientMrrSnapshot.findMany({
        where: { month: { lt: baseline } },
        select: { administratorId: true },
        distinct: ['administratorId'],
      }),
    ]);

    const byMonth = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const key = monthKey(row.month);
      if (!byMonth.has(key)) byMonth.set(key, new Map());
      byMonth.get(key)!.set(row.administratorId, Number(row.mrr));
    }
    byMonth.set(monthKey(current), live);

    const firstData = earliest._min.month
      ? startOfMonth(earliest._min.month)
      : current;
    const first = firstData > windowStart ? firstData : windowStart;
    const months: MrrMonth[] = [];
    // Everyone who paid before the first shown month: coming back is a reactivation, not new business.
    const everPaid = new Set(paidBefore.map((row) => row.administratorId));
    for (let m = baseline; m < first; m = addMonths(m, 1)) {
      for (const id of byMonth.get(monthKey(m))?.keys() ?? []) everPaid.add(id);
    }
    let prev =
      byMonth.get(monthKey(addMonths(first, -1))) ?? new Map<string, number>();
    for (let m = first; m <= current; m = addMonths(m, 1)) {
      const curr = byMonth.get(monthKey(m)) ?? new Map<string, number>();
      months.push({
        month: monthKey(m),
        mrr: sum(curr),
        payingClients: curr.size,
        movements: mrrMovements(prev, curr, everPaid),
      });
      for (const id of curr.keys()) everPaid.add(id);
      prev = curr;
    }

    return {
      currentMrr: sum(live),
      payingClients: live.size,
      dataSince: monthKey(firstData < current ? firstData : current),
      months,
    };
  }

  /** «Actividad reciente»: the latest business events of every despacho. */
  recentActivity(limit = 20): Promise<BusinessEvent[]> {
    return this.prisma.adminActivityItem.findMany({
      where: { type: { in: BUSINESS_EVENTS } },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), MAX_ACTIVITY),
      select: {
        id: true,
        type: true,
        title: true,
        occurredAt: true,
        administrator: { select: { id: true, name: true } },
      },
    });
  }

  /** MRR each paying client brings today (only clients above zero). */
  private async liveContributions(today: Date): Promise<Map<string, number>> {
    const admins = await this.prisma.administrator.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        status: true,
        mrr: true,
        discountPct: true,
        discountUntil: true,
        deletedAt: true,
        subscription: { select: { stripeSubscriptionId: true, status: true } },
      },
    });
    const paying = new Map<string, number>();
    for (const admin of admins) {
      const client: MrrClient = {
        ...admin,
        mrr: Number(admin.mrr),
        discountPct: Number(admin.discountPct),
      };
      const value = mrrContribution(client, today);
      if (value > 0) paying.set(admin.id, value);
    }
    return paying;
  }
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function sum(values: Map<string, number>): number {
  let total = 0;
  for (const value of values.values()) total += value;
  return Math.round(total * 100) / 100;
}
