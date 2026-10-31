import type {
  ClientStatus,
  PaymentStatus,
} from '../client-status/client-status';
import type { ClientHealthConfig } from './client-health.config';

/**
 * Salud of a despacho and «Requieren atención» (odd/tasks/role-a-panel.md
 * S14, S7): one rules engine. Every signal is a 0-100 score (100 = healthy)
 * or null when it cannot be judged yet; both salud and the attention reasons
 * read the same signals.
 */

const DAY_MS = 86_400_000;
const round1 = (value: number): number => Math.round(value * 10) / 10;
const utcDay = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export function paymentSignal(
  status: PaymentStatus,
  config: ClientHealthConfig,
): number {
  return config.paymentScore[status];
}

/**
 * Serious open support tickets. `null` = the support module does not exist
 * yet (S16): the signal is unavailable, never a deduction.
 */
export function supportSignal(
  seriousTickets: number | null,
  config: ClientHealthConfig,
): number | null {
  if (seriousTickets === null) return null;
  return Math.max(0, 100 - seriousTickets * config.supportPenaltyPerTicket);
}

/**
 * Days of the usage window in which activity could have been recorded: from
 * the latest of the window start, the despacho's signup day and the first day
 * usage was ever captured (T4 started recently), until today included.
 */
export function observedUsageDays(
  input: { today: Date; createdAt: Date; firstCapturedDay: Date | null },
  config: ClientHealthConfig,
): number {
  if (!input.firstCapturedDay) return 0;
  const today = utcDay(input.today);
  const windowStart = today - (config.usage.windowDays - 1) * DAY_MS;
  const start = Math.max(
    windowStart,
    utcDay(input.createdAt),
    utcDay(input.firstCapturedDay),
  );
  return start > today ? 0 : Math.round((today - start) / DAY_MS) + 1;
}

export interface UsageSignal {
  score: number;
  /** Active days vs the days expected in the observed period. */
  frequency: number;
  /** Share of the despacho's role B staff active in the window. */
  adoption: number;
}

export interface UsageInput {
  activeDays: number;
  activeUsers: number;
  /** Current (not deleted) role B users of the despacho. */
  staffUsers: number;
  observedDays: number;
}

/**
 * Role B staff usage of the window. A despacho with fewer observable days
 * than `minObservedDays` (just signed up, or capture just started) is not
 * scored: null, so short history never punishes it. The expected active days
 * scale with the observed days.
 */
export function usageSignal(
  input: UsageInput,
  config: ClientHealthConfig,
): UsageSignal | null {
  const { windowDays, expectedActiveDays, minObservedDays } = config.usage;
  if (input.observedDays < minObservedDays) return null;
  const expected = Math.max(
    1,
    Math.round((expectedActiveDays * input.observedDays) / windowDays),
  );
  const frequency = Math.min(1, input.activeDays / expected) * 100;
  const adoption =
    input.staffUsers > 0
      ? Math.min(1, input.activeUsers / input.staffUsers) * 100
      : input.activeUsers > 0
        ? 100
        : 0;
  return {
    score: round1((frequency + adoption) / 2),
    frequency: round1(frequency),
    adoption: round1(adoption),
  };
}

export type HealthSignalKey = 'payment' | 'usage' | 'completeness' | 'support';
export type SaludMotivoCode =
  'payment' | 'low_usage' | 'low_adoption' | 'completeness' | 'support';

export interface HealthSignals {
  payment: number;
  usage: UsageSignal | null;
  /** Completitud total, 0-100. */
  completeness: number;
  support: number | null;
}

export interface SignalBreakdown {
  key: HealthSignalKey;
  score: number | null;
  weight: number;
  /** Points of salud this signal takes away. */
  deduction: number;
  available: boolean;
}

export interface SaludMotivo {
  code: SaludMotivoCode;
  label: string;
}

export interface SaludResult {
  salud: number;
  /** The signal that subtracts most; null when nothing subtracts. */
  motivo: SaludMotivo | null;
  signals: SignalBreakdown[];
}

/** Also the tie-break order of the motivo. */
const SIGNAL_ORDER: HealthSignalKey[] = [
  'payment',
  'usage',
  'completeness',
  'support',
];

const MOTIVO_LABEL: Record<SaludMotivoCode, string> = {
  payment: 'Pagos pendientes',
  low_usage: 'Uso muy bajo',
  low_adoption: 'Baja adopción',
  completeness: 'Onboarding incompleto',
  support: 'Incidencias graves',
};

/**
 * Weighted mean of the available signals (an unavailable one is left out of
 * the weights, so it neither adds nor subtracts). The motivo is the signal
 * with the largest deduction; ties go to the first in SIGNAL_ORDER. Usage is
 * named «Baja adopción» when the staff share is its weaker half.
 */
export function saludIndex(
  signals: HealthSignals,
  config: ClientHealthConfig,
): SaludResult {
  const scores: Record<HealthSignalKey, number | null> = {
    payment: signals.payment,
    usage: signals.usage?.score ?? null,
    completeness: signals.completeness,
    support: signals.support,
  };
  const totalWeight = SIGNAL_ORDER.reduce(
    (sum, key) => sum + (scores[key] === null ? 0 : config.weights[key]),
    0,
  );

  let weighted = 0;
  // Assigned inside the callback: typed through `as` so control flow does not narrow it to null.
  let worst = null as { key: HealthSignalKey; lost: number } | null;
  const breakdown = SIGNAL_ORDER.map((key): SignalBreakdown => {
    const score = scores[key];
    const weight = config.weights[key];
    if (score === null || totalWeight === 0)
      return { key, score, weight, deduction: 0, available: score !== null };
    weighted += weight * score;
    // Compared unrounded and un-normalised (same denominator) so ties are exact.
    const lost = weight * (100 - score);
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { key, lost };
    return {
      key,
      score,
      weight,
      deduction: round1(lost / totalWeight),
      available: true,
    };
  });

  const salud = totalWeight === 0 ? 100 : round1(weighted / totalWeight);
  return {
    salud,
    motivo: worst ? motivoFor(worst.key, signals) : null,
    signals: breakdown,
  };
}

function motivoFor(key: HealthSignalKey, signals: HealthSignals): SaludMotivo {
  const code: SaludMotivoCode =
    key === 'usage'
      ? signals.usage && signals.usage.adoption < signals.usage.frequency
        ? 'low_adoption'
        : 'low_usage'
      : key;
  return { code, label: MOTIVO_LABEL[code] };
}

/** «En riesgo» is a flag, never a client status: below the threshold, and never for Cancelado. */
export function isAtRisk(
  salud: number | null,
  clientStatus: ClientStatus,
  config: ClientHealthConfig,
): boolean {
  return (
    clientStatus !== 'Cancelado' && salud !== null && salud < config.atRiskBelow
  );
}

export type AttentionReasonCode =
  'overdue_payment' | 'serious_tickets' | 'low_activity' | 'onboarding_blocked';

export interface AttentionReason {
  code: AttentionReasonCode;
  label: string;
  /** 3 = act now, 2 = this week, 1 = follow up. */
  severity: number;
}

export interface AttentionInput {
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  /** Usage signal score, null during its grace period. */
  usageScore: number | null;
  onboardingComplete: boolean;
  createdAt: Date;
  /** null while the support module does not exist. */
  seriousTickets: number | null;
  now: Date;
}

/**
 * Why Domora should act on a despacho (S7), from the same signals as salud:
 * pagos vencidos (payment Vencido or Fallido), incidencias graves sin
 * resolver, baja actividad (usage below the configured score) and onboarding
 * bloqueado (a required step still pending `onboardingBlockedAfterDays` after
 * signup). Cancelado despachos never need attention. Sorted by severity.
 */
export function attentionReasons(
  input: AttentionInput,
  config: ClientHealthConfig,
): AttentionReason[] {
  if (input.clientStatus === 'Cancelado') return [];
  const reasons: AttentionReason[] = [];
  if (input.paymentStatus === 'Vencido' || input.paymentStatus === 'Fallido') {
    reasons.push({
      code: 'overdue_payment',
      label: 'Pagos vencidos',
      severity: 3,
    });
  }
  if (input.seriousTickets !== null && input.seriousTickets > 0) {
    reasons.push({
      code: 'serious_tickets',
      label: 'Incidencias graves sin resolver',
      severity: 3,
    });
  }
  if (
    input.usageScore !== null &&
    input.usageScore < config.usage.lowActivityBelow
  ) {
    reasons.push({
      code: 'low_activity',
      label: 'Baja actividad',
      severity: 2,
    });
  }
  const ageDays = (input.now.getTime() - input.createdAt.getTime()) / DAY_MS;
  if (
    !input.onboardingComplete &&
    ageDays >= config.onboardingBlockedAfterDays
  ) {
    reasons.push({
      code: 'onboarding_blocked',
      label: 'Onboarding bloqueado',
      severity: 1,
    });
  }
  return reasons.sort((a, b) => b.severity - a.severity);
}

interface Sortable {
  name: string;
  salud: number | null;
  reasons: { severity: number }[];
}

/** Highest severity first, then more reasons, then lower salud (unknown last), then name. */
export function compareAttention(a: Sortable, b: Sortable): number {
  const top = (x: Sortable) => Math.max(0, ...x.reasons.map((r) => r.severity));
  return (
    top(b) - top(a) ||
    b.reasons.length - a.reasons.length ||
    (a.salud ?? Number.POSITIVE_INFINITY) -
      (b.salud ?? Number.POSITIVE_INFINITY) ||
    a.name.localeCompare(b.name, 'es')
  );
}
