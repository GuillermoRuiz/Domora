import { AdminStatus, SubscriptionStatus, type AdminInvoiceStatus } from '../prisma/client';

/**
 * Client status vs payment status of a despacho (odd/tasks/role-a-panel.md
 * S6, mapping agreed in L32). Both are derived on read from what billing
 * already stores — `AdminStatus` (read by `SubscriptionStatusGuard`), the
 * Stripe subscription status and the Domora invoices — and never persisted:
 * «no confundir el estado del cliente con su situación de pago».
 */
export type ClientStatus = 'En prueba' | 'En onboarding' | 'Activo' | 'Suspendido' | 'Cancelado';
export type PaymentStatus = 'Al día' | 'Pendiente' | 'Vencido' | 'Fallido';

export interface ClientStatusInput {
  status: AdminStatus;
  deletedAt: Date | null;
  /** Status of the Stripe subscription, null for manually billed clients. */
  stripeStatus: SubscriptionStatus | null;
  /** Every required setup step done (CompletenessService); only read for Activo clients. */
  onboardingComplete: boolean;
}

const SUSPENDED: ReadonlySet<AdminStatus> = new Set([AdminStatus.Vencida, AdminStatus.Bloqueada]);

/**
 * Precedence, first match wins:
 * 1. Cancelado — deleted despacho or Stripe `canceled`. A despacho moved to
 *    manual billing by role A («Pasar a facturación manual», T14) has its dead
 *    Stripe subscription detached, so it is no longer Cancelado; the MRR
 *    (mrr.ts) and the completitud average read the same fields, so the panel
 *    stays consistent.
 * 2. Suspendido — `Vencida` or `Bloqueada`, also during a trial: access is
 *    actually cut by `SubscriptionStatusGuard`.
 * 3. En prueba — Stripe `trialing`.
 * 4. Activo — `Activa` or `Periodo de gracia`; shown as En onboarding while a
 *    required setup step (S10) is pending.
 */
export function clientStatus(input: ClientStatusInput): ClientStatus {
  if (input.deletedAt || input.stripeStatus === SubscriptionStatus.canceled) return 'Cancelado';
  if (SUSPENDED.has(input.status)) return 'Suspendido';
  if (input.stripeStatus === SubscriptionStatus.trialing) return 'En prueba';
  return input.onboardingComplete ? 'Activo' : 'En onboarding';
}

export interface InvoiceForStatus {
  status: AdminInvoiceStatus;
  /** What the client owes: VAT included. */
  total: number;
  /** Generated from a Stripe invoice (`stripeInvoiceId`). */
  stripe: boolean;
}

export interface PaymentStatusInput {
  status: AdminStatus;
  stripeStatus: SubscriptionStatus | null;
  invoices: InvoiceForStatus[];
}

/** Stripe statuses of a failed charge: still retrying (`past_due`) or out of retries without cancelling (`unpaid`). */
const FAILED_STRIPE: ReadonlySet<SubscriptionStatus> = new Set([SubscriptionStatus.past_due, SubscriptionStatus.unpaid]);

/**
 * Precedence Vencido > Fallido > Pendiente > Al día: the most serious debt
 * wins. Vencido = the despacho is `Vencida` (grace exhausted or Stripe gave
 * up) or an invoice is overdue. One exception, founded on the billing code:
 * `invoice.payment_failed` marks the Stripe invoice `Vencida` on the very
 * first failed attempt, while the despacho is still in its 7-day grace
 * (`past_due`). L32 calls that situation Fallido, so a Stripe invoice that is
 * Vencida while its subscription is `past_due` counts as a failed charge,
 * not as an overdue one.
 */
export function paymentStatus(input: PaymentStatusInput): PaymentStatus {
  const retrying = input.stripeStatus === SubscriptionStatus.past_due;
  const overdue = input.invoices.some((i) => i.status === 'Vencida' && !(i.stripe && retrying));
  if (input.status === AdminStatus.Vencida || overdue) return 'Vencido';
  if ((input.stripeStatus && FAILED_STRIPE.has(input.stripeStatus)) || input.status === AdminStatus.Periodo_de_gracia) return 'Fallido';
  if (input.invoices.some((i) => i.status === 'Pendiente')) return 'Pendiente';
  return 'Al día';
}

export interface PendingInvoicesSummary {
  /** Unpaid invoices: Pendiente (in term) + Vencida. */
  count: number;
  /** Their total in euros, VAT included (what the client owes). */
  amount: number;
  overdueCount: number;
  overdueAmount: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function pendingInvoicesSummary(invoices: InvoiceForStatus[]): PendingInvoicesSummary {
  const unpaid = invoices.filter((i) => i.status === 'Pendiente' || i.status === 'Vencida');
  const overdue = unpaid.filter((i) => i.status === 'Vencida');
  const sum = (list: InvoiceForStatus[]) => round2(list.reduce((acc, i) => acc + i.total, 0));
  return { count: unpaid.length, amount: sum(unpaid), overdueCount: overdue.length, overdueAmount: sum(overdue) };
}
