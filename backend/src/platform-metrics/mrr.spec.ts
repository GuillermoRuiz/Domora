import { AdminStatus, SubscriptionStatus } from '../prisma/client';
import { mrrContribution, mrrMovements, monthlyAmountFromPrice, type MrrClient } from './mrr';

const TODAY = new Date('2026-10-25T10:00:00Z');

function client(overrides: Partial<MrrClient> = {}): MrrClient {
  return {
    id: 'a1',
    status: AdminStatus.Activa,
    mrr: 100,
    discountPct: 0,
    discountUntil: null,
    deletedAt: null,
    subscription: null,
    ...overrides,
  };
}

describe('monthlyAmountFromPrice', () => {
  it('keeps a monthly price as it is (unit amount × quantity, in euros)', () => {
    expect(monthlyAmountFromPrice({ unitAmount: 4900, quantity: 2, interval: 'month', intervalCount: 1 })).toBe(98);
  });

  it('spreads an annual price over twelve months', () => {
    expect(monthlyAmountFromPrice({ unitAmount: 120000, quantity: 1, interval: 'year', intervalCount: 1 })).toBe(100);
  });

  it('spreads a multi-month interval over its months', () => {
    expect(monthlyAmountFromPrice({ unitAmount: 30000, quantity: 1, interval: 'month', intervalCount: 3 })).toBe(100);
  });

  it('has no amount without unit amount or quantity', () => {
    expect(monthlyAmountFromPrice({ unitAmount: null, quantity: 1, interval: 'month', intervalCount: 1 })).toBeUndefined();
    expect(monthlyAmountFromPrice({ unitAmount: 4900, quantity: null, interval: 'month', intervalCount: 1 })).toBeUndefined();
  });
});

describe('mrrContribution', () => {
  it.each([SubscriptionStatus.active, SubscriptionStatus.past_due])('counts a Stripe subscription in %s', (status) => {
    expect(mrrContribution(client({ subscription: { stripeSubscriptionId: 'sub_1', status } }), TODAY)).toBe(100);
  });

  it.each([
    SubscriptionStatus.trialing,
    SubscriptionStatus.canceled,
    SubscriptionStatus.unpaid,
    SubscriptionStatus.incomplete,
    SubscriptionStatus.incomplete_expired,
    SubscriptionStatus.paused,
  ])('does not count a Stripe subscription in %s', (status) => {
    expect(mrrContribution(client({ subscription: { stripeSubscriptionId: 'sub_1', status } }), TODAY)).toBe(0);
  });

  it.each([AdminStatus.Activa, AdminStatus.Periodo_de_gracia])('counts a manually billed client in %s', (status) => {
    expect(mrrContribution(client({ status }), TODAY)).toBe(100);
  });

  it.each([AdminStatus.Vencida, AdminStatus.Bloqueada])('does not count a manually billed client in %s', (status) => {
    expect(mrrContribution(client({ status }), TODAY)).toBe(0);
  });

  it('treats a Stripe customer without a subscription id as manually billed', () => {
    expect(mrrContribution(client({ subscription: { stripeSubscriptionId: null, status: null } }), TODAY)).toBe(100);
  });

  it('does not count a deleted client', () => {
    expect(mrrContribution(client({ deletedAt: new Date('2026-10-01') }), TODAY)).toBe(0);
  });

  it('keeps the discount while it is valid (the stored mrr is already net)', () => {
    expect(mrrContribution(client({ mrr: 80, discountPct: 20, discountUntil: new Date('2026-10-25') }), TODAY)).toBe(80);
    expect(mrrContribution(client({ mrr: 80, discountPct: 20, discountUntil: null }), TODAY)).toBe(80);
  });

  it('ignores a leftover manual discount once Stripe bills the client (Stripe never discounts)', () => {
    const stripe = client({
      mrr: 49,
      discountPct: 20,
      discountUntil: new Date('2026-01-31'),
      subscription: { stripeSubscriptionId: 'sub_1', status: SubscriptionStatus.active },
    });
    expect(mrrContribution(stripe, TODAY)).toBe(49);
  });

  it('drops an expired discount and counts the full price', () => {
    expect(mrrContribution(client({ mrr: 80, discountPct: 20, discountUntil: new Date('2026-10-24') }), TODAY)).toBe(100);
  });
});

describe('mrrMovements', () => {
  const prev = new Map([['grow', 100], ['shrink', 100], ['leave', 50], ['same', 30]]);
  const curr = new Map([['grow', 150], ['shrink', 60], ['same', 30], ['fresh', 40], ['back', 70]]);

  it('splits the monthly change into new, expansion, contraction, churn and reactivation', () => {
    const everPaid = new Set(['grow', 'shrink', 'leave', 'same', 'back']);
    expect(mrrMovements(prev, curr, everPaid)).toEqual({
      new: 40,
      expansion: 50,
      contraction: 40,
      churn: 50,
      reactivation: 70,
      net: 70,
      signups: 2,
      cancellations: 1,
    });
  });

  it('counts the clients that start paying (new or back) and the ones that stop', () => {
    const everPaid = new Set(['grow', 'shrink', 'leave', 'same', 'back']);
    expect(mrrMovements(prev, curr, everPaid)).toMatchObject({ signups: 2, cancellations: 1 });
  });

  it('counts a client as new when it never paid before', () => {
    expect(mrrMovements(new Map(), new Map([['x', 10]]), new Set())).toMatchObject({ new: 10, reactivation: 0, net: 10 });
  });
});
