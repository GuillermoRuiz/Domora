import type { PaymentStatus } from '../client-status/client-status';

/**
 * Initial, configurable values of the salud index and the «Requieren
 * atención» rules (odd/tasks/role-a-panel.md S14: "valores iniciales
 * configurables"). The project has no typed numeric configuration (only two
 * ad-hoc `Number(process.env.X)` reads), so they live here as one typed
 * object, injected through `CLIENT_HEALTH_CONFIG` so a later settings screen
 * or test can replace it without touching the rules.
 */
export interface ClientHealthConfig {
  /** Relative weight of each signal. Only available signals count (see `saludIndex`). */
  weights: { payment: number; usage: number; completeness: number; support: number };
  /** «En riesgo» when salud is strictly below this value (0-100). */
  atRiskBelow: number;
  /** Score (0-100) of each payment status. */
  paymentScore: Record<PaymentStatus, number>;
  usage: {
    /** Days looked at, today included. */
    windowDays: number;
    /** Active days in a full window that already count as healthy use. */
    expectedActiveDays: number;
    /** Below this many observable days the usage signal is not scored yet (grace). */
    minObservedDays: number;
    /** «Baja actividad» when the usage score is strictly below this value. */
    lowActivityBelow: number;
  };
  /** «Onboarding bloqueado» once a despacho is this many days old with a required step pending. */
  onboardingBlockedAfterDays: number;
  /** Points subtracted from the support score per serious open ticket. */
  supportPenaltyPerTicket: number;
}

/**
 * Reasoning behind the defaults:
 * - payment 40: a failed or overdue charge is the most direct churn signal
 *   (involuntary churn) and the one Domora can act on at once.
 * - usage 35: disengagement is the main leading indicator of voluntary churn.
 * - completeness 15: matters early, but a fully configured despacho can still
 *   leave; it mostly explains low usage.
 * - support 10: serious unresolved tickets hurt, but the module does not exist
 *   yet (S16), so today the signal is unavailable and its weight is left out.
 * - threshold 70: with these weights any one serious problem alone puts a
 *   despacho «En riesgo» — an overdue payment (salud 56), a failed charge
 *   (67) or no use at all in 30 days (61) — while an incomplete setup alone
 *   (completitud 0 → 83) does not.
 * - payment scores: an invoice still in term («Pendiente») is normal and does
 *   not subtract; a failed charge in its grace period is 25; overdue is 0.
 * - usage: 12 active days in 30 ≈ three working days a week; 7 observable days
 *   are the minimum to judge a week of use; «Baja actividad» below 40.
 * - onboarding blocked after 14 days: a usual trial length — two weeks
 *   without the required steps means the despacho is stuck, not just new.
 */
export const DEFAULT_CLIENT_HEALTH_CONFIG: ClientHealthConfig = {
  weights: { payment: 40, usage: 35, completeness: 15, support: 10 },
  atRiskBelow: 70,
  paymentScore: { 'Al día': 100, Pendiente: 100, Fallido: 25, Vencido: 0 },
  usage: { windowDays: 30, expectedActiveDays: 12, minObservedDays: 7, lowActivityBelow: 40 },
  onboardingBlockedAfterDays: 14,
  supportPenaltyPerTicket: 50,
};

export const CLIENT_HEALTH_CONFIG = Symbol('CLIENT_HEALTH_CONFIG');
