import type { AdminPayMethod, SubscriptionStatus } from '../prisma/client';
import type {
  SetupStep,
  SetupStepStatus,
  SetupStepWeight,
} from '../estates/estate-setup.service';

export type OfficeSetupStepKey =
  'contact' | 'billing' | 'payment' | 'estates' | 'team' | 'twoFactor';

export interface OfficeSetupStep {
  key: OfficeSetupStepKey;
  weight: SetupStepWeight;
  status: SetupStepStatus;
  done?: number;
}

/** What the despacho steps are derived from, read in batch by `CompletenessService`. */
export interface OfficeSetupInput {
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  billing: {
    businessName: string;
    cif: string;
    address: string;
    email: string;
    paymentMethod: AdminPayMethod;
    iban: string | null;
  } | null;
  subscription: {
    stripeSubscriptionId: string | null;
    status: SubscriptionStatus | null;
  } | null;
  /** Non-deleted estates. */
  estates: number;
  /** Active role B users of the despacho other than the primary one. */
  otherActiveUsers: number;
  usedTeamInvites: number;
  /** `null` when the despacho has no (active) primary user. */
  primaryTotpEnabled: boolean | null;
}

type Weighted = Pick<SetupStep, 'weight' | 'status'>;

/** Stripe states in which the subscription no longer charges anything. */
const DEAD_SUBSCRIPTION: (SubscriptionStatus | null)[] = [
  null,
  'canceled',
  'incomplete_expired',
];

const filled = (value: string | null | undefined): boolean => !!value?.trim();
const status = (done: boolean): SetupStepStatus => (done ? 'done' : 'pending');

/**
 * Despacho-level setup steps (odd/tasks/role-a-panel.md S10), derived on read
 * and never persisted, like the estate checklist of `EstateSetupService`: the
 * data is edited from several screens and a stored flag would drift.
 */
export function officeSetupSteps(input: OfficeSetupInput): OfficeSetupStep[] {
  const billing = input.billing;
  const billingDone =
    !!billing &&
    [billing.businessName, billing.cif, billing.address, billing.email].every(
      filled,
    );
  // Domiciliación without an IBAN cannot be charged; any other method can.
  const manualPayment =
    !!billing &&
    (billing.paymentMethod !== 'Domiciliacion' || filled(billing.iban));
  const stripePayment =
    !!input.subscription?.stripeSubscriptionId &&
    !DEAD_SUBSCRIPTION.includes(input.subscription.status);
  return [
    {
      key: 'contact',
      weight: 'recommended',
      status: status(
        [input.contactName, input.contactEmail, input.phone].every(filled),
      ),
    },
    { key: 'billing', weight: 'required', status: status(billingDone) },
    {
      key: 'payment',
      weight: 'required',
      status: status(manualPayment || stripePayment),
    },
    {
      key: 'estates',
      weight: 'required',
      status: status(input.estates > 0),
      done: input.estates,
    },
    {
      key: 'team',
      weight: 'info',
      status: status(input.otherActiveUsers > 0 || input.usedTeamInvites > 0),
    },
    {
      key: 'twoFactor',
      weight: 'recommended',
      status: status(input.primaryTotpEnabled === true),
    },
  ];
}

/** Share of the required + recommended steps that are done, 0-100. `info` steps never count (L11, L12). */
export function stepsPercent(steps: Weighted[]): number {
  const counted = steps.filter((s) => s.weight !== 'info');
  if (counted.length === 0) return 0;
  return (
    (counted.filter((s) => s.status === 'done').length / counted.length) * 100
  );
}

export interface Completeness {
  office: number;
  /** Mean of the estates' percentages; 0 without estates. */
  estates: number;
  total: number;
}

/** Despacho completitud = 50% its own steps + 50% the mean of its estates (L13). */
export function completeness(
  officeSteps: Weighted[],
  estateSteps: Weighted[][],
): Completeness {
  const office = stepsPercent(officeSteps);
  const estates =
    estateSteps.length === 0
      ? 0
      : estateSteps.reduce((sum, steps) => sum + stepsPercent(steps), 0) /
        estateSteps.length;
  return { office, estates, total: (office + estates) / 2 };
}

const requiredDone = (steps: Weighted[]): boolean =>
  steps.every((s) => s.weight !== 'required' || s.status === 'done');

/**
 * Onboarding is finished when every required despacho step and every required
 * step of each of its estates is done, with at least one estate. Same rule for
 * the derived «En onboarding» status (S6) and the business event (S11).
 */
export function onboardingComplete(
  officeSteps: Weighted[],
  estateSteps: Weighted[][],
): boolean {
  return (
    estateSteps.length > 0 &&
    requiredDone(officeSteps) &&
    estateSteps.every(requiredDone)
  );
}
