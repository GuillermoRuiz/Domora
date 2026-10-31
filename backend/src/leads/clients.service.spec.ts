import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { ClientsService } from './clients.service';

const NOW = new Date('2026-10-26T10:00:00Z');

function admin(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: new Date('2026-01-15T09:00:00Z'),
    status: 'Activa',
    mrr: new Prisma.Decimal(49),
    discountPct: new Prisma.Decimal(0),
    discountUntil: null,
    deletedAt: null,
    billingInterval: 'month',
    endDate: null,
    subscription: null,
    nextAction: null,
    ...overrides,
  };
}

function office(administratorId: string, clientStatus: string) {
  return { administratorId, clientStatus };
}

describe('ClientsService.overview (S13)', () => {
  let prisma: any;
  let health: any;
  let usage: any;
  let service: ClientsService;

  beforeEach(() => {
    prisma = {
      administrator: {
        findMany: jest.fn().mockResolvedValue([
          // Annual Stripe, renews in 30 days: 49 €/month × 12.
          admin('annual', {
            billingInterval: 'year',
            subscription: {
              stripeSubscriptionId: 'sub_1',
              status: 'active',
              currentPeriodEnd: new Date('2026-11-25T00:00:00Z'),
              cancelAtPeriodEnd: false,
            },
            nextAction: {
              nextAction: 'Llamar para la renovación',
              nextActionAt: new Date('2026-11-01'),
            },
          }),
          // Manual term contract beyond the window: has a date, outside the KPI.
          admin('term', {
            mrr: new Prisma.Decimal(99),
            endDate: new Date('2027-03-01'),
          }),
          // Manual term contract inside the window.
          admin('term-soon', {
            mrr: new Prisma.Decimal(10.5),
            endDate: new Date('2026-12-01'),
          }),
          // Trial: no MRR, never a renewal, counted «En prueba».
          admin('trial', {
            subscription: {
              stripeSubscriptionId: 'sub_2',
              status: 'trialing',
              currentPeriodEnd: new Date('2026-11-01'),
              cancelAtPeriodEnd: false,
            },
          }),
          // Suspended manual client: not active.
          admin('suspended', { status: 'Vencida' }),
        ]),
      },
    };
    health = {
      overview: jest.fn().mockResolvedValue({
        atRiskBelow: 70,
        churnRisk: 2,
        offices: [
          office('annual', 'Activo'),
          office('term', 'En onboarding'),
          office('term-soon', 'Activo'),
          office('trial', 'En prueba'),
          office('suspended', 'Suspendido'),
        ],
      }),
    };
    usage = {
      lastActiveDays: jest
        .fn()
        .mockResolvedValue(new Map([['annual', '2026-10-24']])),
    };
    service = new ClientsService(prisma, health, usage);
  });

  it('returns the KPIs: active (paying) clients, trials, renewals in 90 days with € and churn risk', async () => {
    const result = await service.overview(NOW);
    expect(result.kpis).toEqual({
      activeClients: 3,
      inTrial: 1,
      renewals: { count: 2, amount: 714, windowDays: 90 },
      churnRisk: 2,
    });
  });

  it('returns per client what /admins does not have: fecha de alta, próxima renovación, última actividad and próxima acción', async () => {
    const result = await service.overview(NOW);
    const byId = new Map(result.clients.map((c) => [c.administratorId, c]));
    expect(byId.get('annual')).toEqual({
      administratorId: 'annual',
      signupAt: new Date('2026-01-15T09:00:00Z'),
      nextRenewal: { date: '2026-11-25', amount: 588 },
      lastActiveDay: '2026-10-24',
      nextAction: 'Llamar para la renovación',
      nextActionAt: '2026-11-01',
    });
    expect(byId.get('term')?.nextRenewal).toEqual({
      date: '2027-03-01',
      amount: 1188,
    });
    expect(byId.get('trial')).toMatchObject({
      nextRenewal: null,
      lastActiveDay: null,
      nextAction: null,
      nextActionAt: null,
    });
    expect(result.clients).toHaveLength(5);
    expect(usage.lastActiveDays).toHaveBeenCalledWith([
      'annual',
      'term',
      'term-soon',
      'trial',
      'suspended',
    ]);
    expect(prisma.administrator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});

describe('ClientsService next action and follow-ups', () => {
  it('a deleted or unknown despacho → 404 and nothing is written', async () => {
    const prisma: any = {
      administrator: { findFirst: jest.fn().mockResolvedValue(null) },
      clientNextAction: { upsert: jest.fn() },
      commercialFollowUp: { create: jest.fn() },
    };
    const service = new ClientsService(prisma, {} as never, {} as never);
    await expect(
      service.setNextAction('x', {
        nextAction: 'Llamar',
        nextActionAt: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addFollowUp('x', { text: 'Hola' }, { id: 'u1' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.clientNextAction.upsert).not.toHaveBeenCalled();
    expect(prisma.commercialFollowUp.create).not.toHaveBeenCalled();
  });
});
