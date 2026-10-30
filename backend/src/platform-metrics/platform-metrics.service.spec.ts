import { AdminStatus, Prisma, SubscriptionStatus } from '../prisma/client';
import { PlatformMetricsService } from './platform-metrics.service';

const TODAY = new Date('2026-10-25T10:00:00Z');
const OCT = new Date('2026-10-01T00:00:00Z');
const SEP = new Date('2026-09-01T00:00:00Z');
const AUG = new Date('2026-08-01T00:00:00Z');

function admin(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: AdminStatus.Activa,
    mrr: new Prisma.Decimal(100),
    discountPct: new Prisma.Decimal(0),
    discountUntil: null,
    deletedAt: null,
    subscription: null,
    ...overrides,
  };
}

function snapshot(month: Date, administratorId: string, mrr: number) {
  return { month, administratorId, mrr: new Prisma.Decimal(mrr) };
}

describe('PlatformMetricsService', () => {
  let prisma: {
    administrator: { findMany: jest.Mock };
    clientMrrSnapshot: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock; aggregate: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PlatformMetricsService;
  /** Snapshot rows the fake database holds; queries filter them like Postgres would. */
  let stored: ReturnType<typeof snapshot>[];

  beforeEach(() => {
    stored = [];
    const inRange = (month: Date, where: { gte?: Date; lt?: Date }) =>
      (!where.gte || month >= where.gte) && (!where.lt || month < where.lt);
    prisma = {
      administrator: { findMany: jest.fn() },
      clientMrrSnapshot: {
        findMany: jest.fn(async (args: { where: { month: { gte?: Date; lt?: Date } }; distinct?: string[] }) => {
          const rows = stored.filter((r) => inRange(r.month, args.where.month));
          if (!args.distinct) return rows;
          return [...new Set(rows.map((r) => r.administratorId))].map((administratorId) => ({ administratorId }));
        }),
        aggregate: jest.fn(async () => ({
          _min: { month: stored.length ? new Date(Math.min(...stored.map((r) => r.month.getTime()))) : null },
        })),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    service = new PlatformMetricsService(prisma as never);
  });

  describe('captureCurrentMonth', () => {
    it('stores the MRR of every paying client for the current month and drops the ones that stopped paying', async () => {
      prisma.administrator.findMany.mockResolvedValue([
        admin('paying'),
        admin('trial', { subscription: { stripeSubscriptionId: 'sub_1', status: SubscriptionStatus.trialing } }),
        admin('blocked', { status: AdminStatus.Bloqueada }),
      ]);

      await service.captureCurrentMonth(TODAY);

      expect(prisma.administrator.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
      expect(prisma.clientMrrSnapshot.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.clientMrrSnapshot.upsert).toHaveBeenCalledWith({
        where: { month_administratorId: { month: OCT, administratorId: 'paying' } },
        update: { mrr: new Prisma.Decimal(100) },
        create: { month: OCT, administratorId: 'paying', mrr: new Prisma.Decimal(100) },
      });
      expect(prisma.clientMrrSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { month: OCT, administratorId: { notIn: ['paying'] } },
      });
    });
  });

  describe('recentActivity', () => {
    it('lists only Domora business events of every despacho, newest first', async () => {
      const rows = [{ id: 'e1', type: 'payment_received', title: 'Pago recibido: 49,00 €', occurredAt: new Date(), administrator: { id: 'a', name: 'Fincas Norte' } }];
      const findMany = jest.fn().mockResolvedValue(rows);
      (prisma as unknown as { adminActivityItem: unknown }).adminActivityItem = { findMany };

      await expect(service.recentActivity(5)).resolves.toBe(rows);
      expect(findMany).toHaveBeenCalledWith({
        where: { type: { in: ['signup', 'plan_change', 'payment_received', 'cancellation_requested', 'onboarding_completed'] } },
        orderBy: { occurredAt: 'desc' },
        take: 5,
        select: { id: true, type: true, title: true, occurredAt: true, administrator: { select: { id: true, name: true } } },
      });
    });

    it('caps the page at 50 entries', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      (prisma as unknown as { adminActivityItem: unknown }).adminActivityItem = { findMany };
      await service.recentActivity(500);
      expect(findMany.mock.calls[0][0].take).toBe(50);
    });
  });

  describe('mrrOverview', () => {
    it('gives the live MRR, paying clients and the monthly series with its movements since the first snapshot', async () => {
      prisma.administrator.findMany.mockResolvedValue([admin('a'), admin('b', { mrr: new Prisma.Decimal(50) })]);
      stored = [snapshot(AUG, 'a', 100), snapshot(AUG, 'c', 30), snapshot(SEP, 'a', 80)];

      const overview = await service.mrrOverview(TODAY);

      expect(overview.currentMrr).toBe(150);
      expect(overview.payingClients).toBe(2);
      expect(overview.dataSince).toBe('2026-08');
      expect(overview.months).toEqual([
        { month: '2026-08', mrr: 130, payingClients: 2, movements: { new: 130, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 130, signups: 2, cancellations: 0 } },
        { month: '2026-09', mrr: 80, payingClients: 1, movements: { new: 0, expansion: 0, contraction: 20, churn: 30, reactivation: 0, net: -50, signups: 0, cancellations: 1 } },
        { month: '2026-10', mrr: 150, payingClients: 2, movements: { new: 50, expansion: 20, contraction: 0, churn: 0, reactivation: 0, net: 70, signups: 1, cancellations: 0 } },
      ]);
    });

    it('marks a returning client as a reactivation', async () => {
      prisma.administrator.findMany.mockResolvedValue([admin('a')]);
      stored = [snapshot(AUG, 'a', 100)];

      const overview = await service.mrrOverview(TODAY);

      expect(overview.months.map((m) => [m.month, m.movements.churn, m.movements.reactivation])).toEqual([
        ['2026-08', 0, 0],
        ['2026-09', 100, 0],
        ['2026-10', 0, 100],
      ]);
    });

    it('starts the series at the current month when nothing was captured yet', async () => {
      prisma.administrator.findMany.mockResolvedValue([admin('a')]);

      const overview = await service.mrrOverview(TODAY);

      expect(overview.dataSince).toBe('2026-10');
      expect(overview.months).toHaveLength(1);
    });

    it('shows twelve months and diffs the first one against the month before it, not against nothing', async () => {
      prisma.administrator.findMany.mockResolvedValue([admin('a')]);
      const months = ['2025-09', '2025-10', '2025-11', '2025-12'];
      stored = months.map((m) => snapshot(new Date(`${m}-01T00:00:00Z`), 'a', 100));

      const overview = await service.mrrOverview(TODAY);

      expect(overview.dataSince).toBe('2025-09');
      expect(overview.months).toHaveLength(12);
      expect(overview.months[0]).toEqual({
        month: '2025-11', mrr: 100, payingClients: 1,
        movements: { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 0, signups: 0, cancellations: 0 },
      });
      expect(overview.months[2].movements.churn).toBe(100);
      expect(overview.months[11].movements).toMatchObject({ new: 0, reactivation: 100 });
    });

    it('counts a client that paid before the window as a reactivation, not as new', async () => {
      prisma.administrator.findMany.mockResolvedValue([admin('a')]);
      stored = [snapshot(new Date('2025-06-01T00:00:00Z'), 'a', 100), snapshot(AUG, 'b', 10)];

      const overview = await service.mrrOverview(TODAY);

      expect(overview.dataSince).toBe('2025-06');
      expect(overview.months.at(-1)!.movements).toMatchObject({ new: 0, reactivation: 100 });
    });
  });
});
