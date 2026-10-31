import { NotFoundException } from '@nestjs/common';
import {
  DEFAULT_CLIENT_HEALTH_CONFIG,
  type ClientHealthConfig,
} from './client-health.config';
import { ClientHealthService } from './client-health.service';
import {
  UnavailableSupportSignalSource,
  type SupportSignalSource,
} from './support-signal';

const NOW = new Date('2026-10-30T10:00:00Z');
const OLD = new Date('2026-01-01T00:00:00Z');

interface Office {
  id: string;
  name: string;
  plan?: string;
  createdAt?: Date;
  clientStatus: string;
  paymentStatus: string;
  completeness: number;
  onboardingComplete?: boolean;
  staff?: number;
  usage?: { activeUsers: number; activeDays: number };
}

/** Every dependency mocked; each returns what the real one would for `offices`. */
function setup(
  offices: Office[],
  opts: {
    support?: SupportSignalSource;
    config?: ClientHealthConfig;
    firstCapturedDay?: Date | null;
  } = {},
) {
  const admins = offices.map((o) => ({
    id: o.id,
    name: o.name,
    plan: o.plan ?? 'BASE',
    createdAt: o.createdAt ?? OLD,
  }));
  const completenessRows = offices.map((o) => ({
    administratorId: o.id,
    name: o.name,
    total: o.completeness,
    onboardingComplete: o.onboardingComplete ?? true,
  }));
  const prisma = {
    administrator: { findMany: jest.fn().mockResolvedValue(admins) },
    user: {
      groupBy: jest.fn().mockResolvedValue(
        offices
          .filter((o) => (o.staff ?? 1) > 0)
          .map((o) => ({
            administratorId: o.id,
            _count: { _all: o.staff ?? 1 },
          })),
      ),
    },
  };
  const completeness = {
    overview: jest
      .fn()
      .mockResolvedValue({ average: 50, offices: completenessRows }),
    detail: jest.fn().mockImplementation((id: string) => {
      const row = completenessRows.find((r) => r.administratorId === id);
      return row
        ? Promise.resolve(row)
        : Promise.reject(new NotFoundException());
    }),
  };
  const clientStatus = {
    forAdministrators: jest.fn().mockImplementation((ids: string[]) =>
      Promise.resolve(
        new Map(
          offices
            .filter((o) => ids.includes(o.id))
            .map((o) => [
              o.id,
              {
                clientStatus: o.clientStatus,
                paymentStatus: o.paymentStatus,
                pendingInvoices: {},
              },
            ]),
        ),
      ),
    ),
  };
  const usage = {
    summary: jest.fn().mockResolvedValue({
      despachos: offices
        .filter((o) => o.usage)
        .map((o) => ({ administratorId: o.id, ...o.usage })),
    }),
    firstCapturedDay: jest
      .fn()
      .mockResolvedValue(
        opts.firstCapturedDay === undefined ? OLD : opts.firstCapturedDay,
      ),
  };
  const support = opts.support ?? new UnavailableSupportSignalSource();
  const service = new ClientHealthService(
    prisma as never,
    completeness as never,
    clientStatus as never,
    usage as never,
    support,
    opts.config ?? DEFAULT_CLIENT_HEALTH_CONFIG,
  );
  return { service, prisma, completeness, clientStatus, usage };
}

const active = (id: string, extra: Partial<Office> = {}): Office => ({
  id,
  name: `Despacho ${id}`,
  clientStatus: 'Activo',
  paymentStatus: 'Al día',
  completeness: 100,
  staff: 2,
  usage: { activeUsers: 2, activeDays: 20 },
  ...extra,
});

describe('ClientHealthService.overview', () => {
  it('uses a fixed number of queries whatever the number of despachos', async () => {
    for (const offices of [
      [active('a')],
      [active('a'), active('b'), active('c'), active('d')],
    ]) {
      const { service, prisma, completeness, clientStatus, usage } =
        setup(offices);
      await service.overview(NOW);
      expect(prisma.administrator.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.groupBy).toHaveBeenCalledTimes(1);
      expect(completeness.overview).toHaveBeenCalledTimes(1);
      expect(clientStatus.forAdministrators).toHaveBeenCalledTimes(1);
      expect(usage.summary).toHaveBeenCalledTimes(1);
      expect(usage.firstCapturedDay).toHaveBeenCalledTimes(1);
      // Completitud computed once and handed to the status service.
      expect(clientStatus.forAdministrators.mock.calls[0][1]).toEqual(
        new Map(offices.map((o) => [o.id, true])),
      );
    }
  });

  it('reads only live despachos, the staff of those despachos and a 30-day usage window ending today', async () => {
    const { service, prisma, usage } = setup([active('a')]);
    await service.overview(NOW);
    expect(prisma.administrator.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
    });
    expect(prisma.user.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['administratorId'],
      where: { role: 'B', deletedAt: null, administratorId: { in: ['a'] } },
    });
    const [from, to] = usage.summary.mock.calls[0];
    expect((from as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect((to as Date).toISOString().slice(0, 10)).toBe('2026-10-30');
  });

  it('scores a healthy despacho 100, not at risk, no motivo and no attention', async () => {
    const { service } = setup([active('a', { plan: 'PREMIUM' })]);
    const { offices } = await service.overview(NOW);
    expect(offices[0]).toMatchObject({
      administratorId: 'a',
      name: 'Despacho a',
      plan: 'PREMIUM',
      clientStatus: 'Activo',
      paymentStatus: 'Al día',
      completeness: 100,
      salud: 100,
      atRisk: false,
      motivo: null,
      attention: [],
      usage: {
        activeDays: 20,
        activeUsers: 2,
        staffUsers: 2,
        observedDays: 30,
      },
    });
    expect(
      offices[0].signals.map((s) => [s.key, s.score, s.available]),
    ).toEqual([
      ['payment', 100, true],
      ['usage', 100, true],
      ['completeness', 100, true],
      ['support', null, false],
    ]);
  });

  it('an overdue despacho is at risk because of payments and needs attention', async () => {
    const { service } = setup([active('a', { paymentStatus: 'Vencido' })]);
    const [office] = (await service.overview(NOW)).offices;
    expect(office.salud).toBe(55.6);
    expect(office.atRisk).toBe(true);
    expect(office.motivo).toEqual({
      code: 'payment',
      label: 'Pagos pendientes',
    });
    expect(office.attention.map((r) => r.code)).toEqual(['overdue_payment']);
  });

  it('a despacho without any recorded use is at risk for low usage', async () => {
    const { service } = setup([active('a', { usage: undefined })]);
    const [office] = (await service.overview(NOW)).offices;
    expect(office.usage).toEqual({
      activeDays: 0,
      activeUsers: 0,
      staffUsers: 2,
      observedDays: 30,
    });
    expect(office.salud).toBe(61.1);
    expect(office.motivo?.code).toBe('low_usage');
    expect(office.attention.map((r) => r.code)).toEqual(['low_activity']);
  });

  it('does not punish a despacho that signed up a few days ago for its short history', async () => {
    const { service } = setup([
      active('a', {
        usage: undefined,
        createdAt: new Date('2026-10-27T09:00:00Z'),
        completeness: 40,
        onboardingComplete: false,
      }),
    ]);
    const [office] = (await service.overview(NOW)).offices;
    expect(office.usage.observedDays).toBe(4);
    expect(office.signals[1]).toMatchObject({ key: 'usage', available: false });
    expect(office.attention).toEqual([]); // neither low activity nor onboarding blocked yet
  });

  it('does not score usage at all before capture started', async () => {
    const { service } = setup([active('a', { usage: undefined })], {
      firstCapturedDay: null,
    });
    const [office] = (await service.overview(NOW)).offices;
    expect(office.signals[1].available).toBe(false);
    expect(office.salud).toBe(100);
  });

  it('a Cancelado despacho has no salud, is never at risk and never needs attention', async () => {
    const { service } = setup([
      active('a', {
        clientStatus: 'Cancelado',
        paymentStatus: 'Vencido',
        usage: undefined,
        onboardingComplete: false,
      }),
    ]);
    const { offices, churnRisk } = await service.overview(NOW);
    expect(offices[0]).toMatchObject({
      salud: null,
      atRisk: false,
      motivo: null,
      attention: [],
      signals: [],
    });
    expect(churnRisk).toBe(0);
    await expect(service.attention(NOW)).resolves.toEqual([]);
  });

  it('Churn risk counts at-risk paying despachos only (Activo, En onboarding), not En prueba or Suspendido', async () => {
    const { service } = setup([
      active('a', { paymentStatus: 'Vencido' }),
      active('b', { clientStatus: 'En onboarding', usage: undefined }),
      active('c', { clientStatus: 'En prueba', usage: undefined }),
      active('d', { clientStatus: 'Suspendido', paymentStatus: 'Vencido' }),
      active('e'),
    ]);
    const overview = await service.overview(NOW);
    expect(
      overview.offices.filter((o) => o.atRisk).map((o) => o.administratorId),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(overview.churnRisk).toBe(2);
    expect(overview.atRiskBelow).toBe(70);
  });

  it('uses the support source once it reports serious tickets', async () => {
    const support = {
      seriousOpenTickets: jest.fn().mockResolvedValue(new Map([['a', 1]])),
    };
    const { service } = setup([active('a'), active('b')], { support });
    const { offices } = await service.overview(NOW);
    expect(support.seriousOpenTickets).toHaveBeenCalledTimes(1);
    expect(support.seriousOpenTickets).toHaveBeenCalledWith(['a', 'b']);
    expect(offices[0].signals[3]).toMatchObject({
      key: 'support',
      score: 50,
      available: true,
    });
    expect(offices[0].attention.map((r) => r.code)).toEqual([
      'serious_tickets',
    ]);
    expect(offices[1].signals[3]).toMatchObject({
      key: 'support',
      score: 100,
      available: true,
    });
  });

  it('applies an injected configuration (weights and threshold)', async () => {
    const config = { ...DEFAULT_CLIENT_HEALTH_CONFIG, atRiskBelow: 50 };
    const { service } = setup([active('a', { paymentStatus: 'Vencido' })], {
      config,
    });
    const { offices, atRiskBelow } = await service.overview(NOW);
    expect(atRiskBelow).toBe(50);
    expect(offices[0].atRisk).toBe(false);
  });

  it('returns an empty overview without further queries when there are no despachos', async () => {
    const { service, usage, clientStatus } = setup([]);
    await expect(service.overview(NOW)).resolves.toEqual({
      atRiskBelow: 70,
      churnRisk: 0,
      offices: [],
    });
    expect(usage.summary).not.toHaveBeenCalled();
    expect(clientStatus.forAdministrators).not.toHaveBeenCalled();
  });
});

describe('ClientHealthService.attention', () => {
  it('lists only the despachos with reasons, with plan, statuses, completitud and salud, most severe first', async () => {
    const { service } = setup([
      active('ok'),
      active('onb', {
        onboardingComplete: false,
        completeness: 30,
        clientStatus: 'En onboarding',
      }),
      active('pay', { paymentStatus: 'Fallido', plan: 'STANDARD' }),
      active('idle', { usage: { activeUsers: 1, activeDays: 1 } }),
      active('both', { paymentStatus: 'Vencido', usage: undefined }),
    ]);
    const items = await service.attention(NOW);
    expect(items.map((i) => i.administratorId)).toEqual([
      'both',
      'pay',
      'idle',
      'onb',
    ]);
    expect(items[1]).toEqual({
      administratorId: 'pay',
      name: 'Despacho pay',
      plan: 'STANDARD',
      clientStatus: 'Activo',
      paymentStatus: 'Fallido',
      completeness: 100,
      salud: 66.7,
      atRisk: true,
      reasons: [
        { code: 'overdue_payment', label: 'Pagos vencidos', severity: 3 },
      ],
    });
    expect(items[0].reasons.map((r) => r.code)).toEqual([
      'overdue_payment',
      'low_activity',
    ]);
  });
});

describe('ClientHealthService.office', () => {
  it('computes one despacho with queries scoped to it', async () => {
    const { service, prisma, completeness, clientStatus } = setup([
      active('a', { paymentStatus: 'Vencido' }),
    ]);
    const office = await service.office('a', NOW);
    expect(office).toMatchObject({ administratorId: 'a', atRisk: true });
    expect(prisma.administrator.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: 'a',
    });
    expect(completeness.detail).toHaveBeenCalledWith('a');
    expect(completeness.overview).not.toHaveBeenCalled();
    expect(clientStatus.forAdministrators.mock.calls[0][0]).toEqual(['a']);
  });

  it('404 for an unknown or deleted despacho', async () => {
    const { service } = setup([]);
    await expect(service.office('zz', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
