import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_GATE_KEY = 'skipSubscriptionGate';

/**
 * Marks a route as exempt from SubscriptionStatusGuard. Reserved for the
 * handful of endpoints a rol B user needs precisely BECAUSE their
 * subscription is expired/blocked: seeing their own status, the plan
 * catalog, their invoices and their basic identity. Without this escape
 * hatch, a blocked administrator could never see *why* nor find a way out.
 */
export const SkipSubscriptionGate = () =>
  SetMetadata(SKIP_SUBSCRIPTION_GATE_KEY, true);
