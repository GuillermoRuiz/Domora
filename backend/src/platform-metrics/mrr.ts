import { AdminStatus, SubscriptionStatus } from '../prisma/client';

/**
 * MRR rules shared by the billing webhook and the platform metrics (SaaS
 * standard, see odd/tasks/role-a-panel.md S9): monthly-normalised, trials and
 * tax excluded, discounts deducted while valid, Stripe and manually billed
 * clients both counted.
 */

/** Stripe statuses that still bring revenue: an unpaid `past_due` counts until it churns. */
const PAYING_STRIPE: ReadonlySet<SubscriptionStatus> = new Set([SubscriptionStatus.active, SubscriptionStatus.past_due]);
/** Manually billed clients that still bring revenue: the grace period is the manual `past_due`. */
const PAYING_MANUAL: ReadonlySet<AdminStatus> = new Set([AdminStatus.Activa, AdminStatus.Periodo_de_gracia]);

export interface StripePrice {
  /** Cents, as Stripe sends it. */
  unitAmount: number | null | undefined;
  quantity: number | null | undefined;
  interval: 'day' | 'week' | 'month' | 'year' | null | undefined;
  intervalCount: number | null | undefined;
}

/** Monthly amount in euros of a Stripe price: an annual price counts a twelfth per month. */
export function monthlyAmountFromPrice(price: StripePrice): number | undefined {
  if (price.unitAmount == null || price.quantity == null) return undefined;
  const months = monthsPerInterval(price.interval) * (price.intervalCount || 1);
  return round2((price.unitAmount * price.quantity) / 100 / months);
}

function monthsPerInterval(interval: StripePrice['interval']): number {
  switch (interval) {
    case 'year': return 12;
    case 'week': return 12 / 52;
    case 'day': return 12 / 365;
    default: return 1;
  }
}

export interface MrrClient {
  id: string;
  status: AdminStatus;
  /** Stored monthly amount, net of the discount (`netMrr`) for manual clients. */
  mrr: number;
  discountPct: number;
  discountUntil: Date | null;
  deletedAt: Date | null;
  subscription: { stripeSubscriptionId: string | null; status: SubscriptionStatus | null } | null;
}

/** What one client adds to the MRR on `today`. */
export function mrrContribution(client: MrrClient, today: Date): number {
  if (client.deletedAt) return 0;
  const stripeStatus = client.subscription?.stripeSubscriptionId ? client.subscription.status : null;
  if (stripeStatus) {
    // Stripe always charges the full price (no coupons): `mrr` is already gross, a leftover manual discount means nothing.
    return PAYING_STRIPE.has(stripeStatus) ? client.mrr : 0;
  }
  if (!PAYING_MANUAL.has(client.status)) return 0;
  return discountExpired(client, today) ? round2(client.mrr / (1 - client.discountPct / 100)) : client.mrr;
}

/** A discount with an end date stops applying the day after it. */
function discountExpired(client: MrrClient, today: Date): boolean {
  if (client.discountPct <= 0 || client.discountPct >= 100 || !client.discountUntil) return false;
  return client.discountUntil.toISOString().slice(0, 10) < today.toISOString().slice(0, 10);
}

export interface MrrMovements {
  new: number;
  expansion: number;
  contraction: number;
  churn: number;
  reactivation: number;
  net: number;
  /** Clients that start paying this month (new or back): the «altas» of the month. */
  signups: number;
  /** Clients that stop paying this month: the «bajas» of the month. */
  cancellations: number;
}

/**
 * Splits the change between two months by client: `everPaid` holds the clients
 * that paid in any month before `prev` or in it, so a returning one is a
 * reactivation and a first-time one is new.
 */
export function mrrMovements(prev: Map<string, number>, curr: Map<string, number>, everPaid: Set<string>): MrrMovements {
  const m: MrrMovements = { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 0, signups: 0, cancellations: 0 };
  for (const id of new Set([...prev.keys(), ...curr.keys()])) {
    const before = prev.get(id) ?? 0;
    const after = curr.get(id) ?? 0;
    if (before === 0 && after > 0) {
      if (everPaid.has(id)) m.reactivation += after;
      else m.new += after;
      m.signups += 1;
    } else if (before > 0 && after === 0) {
      m.churn += before;
      m.cancellations += 1;
    } else if (after > before) m.expansion += after - before;
    else if (after < before) m.contraction += before - after;
  }
  for (const key of ['new', 'expansion', 'contraction', 'churn', 'reactivation'] as const) m[key] = round2(m[key]);
  m.net = round2(m.new + m.expansion + m.reactivation - m.contraction - m.churn);
  return m;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
