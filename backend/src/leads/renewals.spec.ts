import { RENEWAL_WINDOW_DAYS, nextRenewal, upcomingRenewals, type RenewalClient } from './renewals';

const TODAY = new Date('2026-10-26T10:00:00Z');

function client(overrides: Partial<RenewalClient> = {}): RenewalClient {
  return {
    id: 'a1',
    status: 'Activa',
    mrr: 49,
    discountPct: 0,
    discountUntil: null,
    deletedAt: null,
    billingInterval: 'month',
    endDate: null,
    subscription: null,
    ...overrides,
  };
}

function stripe(overrides: Partial<NonNullable<RenewalClient['subscription']>> = {}): RenewalClient['subscription'] {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'active',
    currentPeriodEnd: new Date('2026-11-25T00:00:00Z'),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('nextRenewal (S13: only annual or term contracts)', () => {
  it('a Stripe annual subscription renews at the end of its period, for twelve months of its MRR', () => {
    expect(nextRenewal(client({ billingInterval: 'year', subscription: stripe() }), TODAY)).toEqual({
      date: '2026-11-25',
      amount: 588,
    });
  });

  it('a monthly Stripe subscription is not a renewal', () => {
    expect(nextRenewal(client({ subscription: stripe() }), TODAY)).toBeNull();
  });

  it('a Stripe annual subscription with a cancellation request does not renew', () => {
    expect(nextRenewal(client({ billingInterval: 'year', subscription: stripe({ cancelAtPeriodEnd: true }) }), TODAY)).toBeNull();
  });

  it('a trial or canceled Stripe subscription brings no revenue, so nothing is at stake', () => {
    expect(nextRenewal(client({ billingInterval: 'year', subscription: stripe({ status: 'trialing' }) }), TODAY)).toBeNull();
    expect(nextRenewal(client({ billingInterval: 'year', subscription: stripe({ status: 'canceled' }) }), TODAY)).toBeNull();
  });

  it('a manually billed term contract renews at its end date, with the valid discount applied', () => {
    expect(
      nextRenewal(
        client({ mrr: 39.2, discountPct: 20, discountUntil: new Date('2027-06-30'), endDate: new Date('2026-12-25') }),
        TODAY,
      ),
    ).toEqual({ date: '2026-12-25', amount: 470.4 });
  });

  it('a manual annual contract without end date has no known renewal date', () => {
    expect(nextRenewal(client({ billingInterval: 'year' }), TODAY)).toBeNull();
  });

  it('a manual monthly contract without end date is not a renewal', () => {
    expect(nextRenewal(client(), TODAY)).toBeNull();
  });

  it('an end date already past, a suspended or a deleted despacho give no renewal', () => {
    expect(nextRenewal(client({ endDate: new Date('2026-10-25') }), TODAY)).toBeNull();
    expect(nextRenewal(client({ endDate: new Date('2026-12-25'), status: 'Vencida' }), TODAY)).toBeNull();
    expect(nextRenewal(client({ endDate: new Date('2026-12-25'), deletedAt: new Date() }), TODAY)).toBeNull();
  });

  it('an end date today still counts as upcoming', () => {
    expect(nextRenewal(client({ endDate: new Date('2026-10-26') }), TODAY)?.date).toBe('2026-10-26');
  });
});

describe('upcomingRenewals (KPI «Renovaciones próximas (90 días)»)', () => {
  it('counts the renewals from today to 90 days ahead, both included, and sums the € at stake', () => {
    expect(RENEWAL_WINDOW_DAYS).toBe(90);
    const result = upcomingRenewals(
      [
        { date: '2026-10-26', amount: 588 },
        { date: '2027-01-24', amount: 470.4 }, // day 90
        { date: '2027-01-25', amount: 1000 }, // day 91: outside
        null,
      ],
      TODAY,
    );
    expect(result).toEqual({ count: 2, amount: 1058.4, windowDays: 90 });
  });
});
