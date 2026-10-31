import type { BillingInterval, SubscriptionStatus } from '../prisma/client';
import { mrrContribution, type MrrClient } from '../platform-metrics/mrr';

/**
 * Renewals of the Clientes screen (odd/tasks/role-a-panel.md S13, L18): only
 * annual or term contracts renew; monthly ones simply keep paying.
 *
 * - Stripe: an annual subscription (`billingInterval = year`) renews at
 *   `currentPeriodEnd`, unless a cancellation was requested
 *   (`cancelAtPeriodEnd`, the «Solicitud de baja»).
 * - Manual billing: a term contract renews at its `endDate`, whatever the
 *   invoicing interval. A manual annual contract without `endDate` has no
 *   known date and is left out.
 * - € at stake = the client's current MRR contribution × 12 (tax excluded,
 *   valid discounts deducted, trials and non-paying clients 0 → no renewal):
 *   for an annual Stripe price it is exactly the annual price.
 */

export const RENEWAL_WINDOW_DAYS = 90;

export interface RenewalClient extends MrrClient {
  billingInterval: BillingInterval;
  endDate: Date | null;
  subscription: {
    stripeSubscriptionId: string | null;
    status: SubscriptionStatus | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

export interface Renewal {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** € at stake: annual recurring value, tax excluded. */
  amount: number;
}

export interface UpcomingRenewals {
  count: number;
  amount: number;
  windowDays: number;
}

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function nextRenewal(
  client: RenewalClient,
  today: Date,
): Renewal | null {
  const monthly = mrrContribution(client, today);
  if (monthly <= 0) return null;
  const date = renewalDate(client);
  if (!date || dayKey(date) < dayKey(today)) return null;
  return { date: dayKey(date), amount: round2(monthly * 12) };
}

function renewalDate(client: RenewalClient): Date | null {
  const sub = client.subscription;
  if (sub?.stripeSubscriptionId) {
    if (client.billingInterval !== 'year' || sub.cancelAtPeriodEnd) return null;
    return sub.currentPeriodEnd;
  }
  return client.endDate;
}

/** Renewals from today to `windowDays` ahead, both days included. */
export function upcomingRenewals(
  renewals: (Renewal | null)[],
  today: Date,
  windowDays = RENEWAL_WINDOW_DAYS,
): UpcomingRenewals {
  const from = dayKey(today);
  const to = dayKey(new Date(new Date(from).getTime() + windowDays * DAY_MS));
  let count = 0;
  let amount = 0;
  for (const r of renewals) {
    if (!r || r.date < from || r.date > to) continue;
    count += 1;
    amount += r.amount;
  }
  return { count, amount: round2(amount), windowDays };
}
