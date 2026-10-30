import { DEFAULT_CLIENT_HEALTH_CONFIG as config } from './client-health.config';
import {
  attentionReasons,
  compareAttention,
  isAtRisk,
  observedUsageDays,
  paymentSignal,
  saludIndex,
  supportSignal,
  usageSignal,
  type HealthSignals,
} from './client-health';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const healthy: HealthSignals = { payment: 100, usage: { score: 100, frequency: 100, adoption: 100 }, completeness: 100, support: null };

describe('paymentSignal', () => {
  it('scores each payment status with the configured values', () => {
    expect(paymentSignal('Al día', config)).toBe(100);
    expect(paymentSignal('Pendiente', config)).toBe(100);
    expect(paymentSignal('Fallido', config)).toBe(25);
    expect(paymentSignal('Vencido', config)).toBe(0);
  });
});

describe('supportSignal', () => {
  it('is unavailable (null) while the support module does not exist', () => {
    expect(supportSignal(null, config)).toBeNull();
  });
  it('subtracts the configured points per serious open ticket, never below 0', () => {
    expect(supportSignal(0, config)).toBe(100);
    expect(supportSignal(1, config)).toBe(50);
    expect(supportSignal(3, config)).toBe(0);
  });
});

describe('observedUsageDays', () => {
  const today = day('2026-10-30');
  it('is the whole window for an old despacho with long history', () => {
    expect(observedUsageDays({ today, createdAt: day('2025-01-01'), firstCapturedDay: day('2026-01-01') }, config)).toBe(30);
  });
  it('starts at the signup day of a new despacho, today included', () => {
    expect(observedUsageDays({ today, createdAt: new Date('2026-10-25T15:00:00Z'), firstCapturedDay: day('2026-01-01') }, config)).toBe(6);
  });
  it('starts at the first captured day when capture began after the window start', () => {
    expect(observedUsageDays({ today, createdAt: day('2025-01-01'), firstCapturedDay: day('2026-10-21') }, config)).toBe(10);
  });
  it('is 0 when nothing was ever captured', () => {
    expect(observedUsageDays({ today, createdAt: day('2025-01-01'), firstCapturedDay: null }, config)).toBe(0);
  });
});

describe('usageSignal', () => {
  it('is unavailable during the grace period (fewer observable days than the minimum)', () => {
    expect(usageSignal({ activeDays: 0, activeUsers: 0, staffUsers: 3, observedDays: 6 }, config)).toBeNull();
  });
  it('scores 7 observable days without activity as 0', () => {
    expect(usageSignal({ activeDays: 0, activeUsers: 0, staffUsers: 3, observedDays: 7 }, config)).toEqual({ score: 0, frequency: 0, adoption: 0 });
  });
  it('averages frequency (active days vs expected) and adoption (active staff share)', () => {
    // 6 of 12 expected days = 50; 1 of 4 staff = 25 → 37.5
    expect(usageSignal({ activeDays: 6, activeUsers: 1, staffUsers: 4, observedDays: 30 }, config)).toEqual({ score: 37.5, frequency: 50, adoption: 25 });
  });
  it('caps both parts at 100', () => {
    expect(usageSignal({ activeDays: 25, activeUsers: 5, staffUsers: 3, observedDays: 30 }, config)).toEqual({ score: 100, frequency: 100, adoption: 100 });
  });
  it('scales the expected days to a short observed history', () => {
    // 10 observed days → 4 expected; 2 active → 50
    expect(usageSignal({ activeDays: 2, activeUsers: 1, staffUsers: 1, observedDays: 10 }, config)).toEqual({ score: 75, frequency: 50, adoption: 100 });
  });
  it('a despacho without staff counts as adopted only if someone was active', () => {
    expect(usageSignal({ activeDays: 0, activeUsers: 0, staffUsers: 0, observedDays: 30 }, config)?.adoption).toBe(0);
    expect(usageSignal({ activeDays: 1, activeUsers: 1, staffUsers: 0, observedDays: 30 }, config)?.adoption).toBe(100);
  });
});

describe('saludIndex', () => {
  it('is 100 with no deduction and no motivo when every signal is perfect', () => {
    expect(saludIndex(healthy, config)).toEqual({
      salud: 100,
      motivo: null,
      signals: [
        { key: 'payment', score: 100, weight: 40, deduction: 0, available: true },
        { key: 'usage', score: 100, weight: 35, deduction: 0, available: true },
        { key: 'completeness', score: 100, weight: 15, deduction: 0, available: true },
        { key: 'support', score: null, weight: 10, deduction: 0, available: false },
      ],
    });
  });

  it('weights only the available signals (support excluded today)', () => {
    // payment 0 → 40/90 of the index lost
    const result = saludIndex({ ...healthy, payment: 0 }, config);
    expect(result.salud).toBe(55.6);
    expect(result.signals[0].deduction).toBe(44.4);
    expect(result.motivo).toEqual({ code: 'payment', label: 'Pagos pendientes' });
  });

  it('counts support once it is available', () => {
    const result = saludIndex({ ...healthy, support: 0 }, config);
    expect(result.salud).toBe(90);
    expect(result.motivo).toEqual({ code: 'support', label: 'Incidencias graves' });
  });

  it('leaves usage out during its grace period', () => {
    const result = saludIndex({ ...healthy, usage: null, completeness: 0 }, config);
    // 15 of 55 lost
    expect(result.salud).toBe(72.7);
    expect(result.signals[1]).toEqual({ key: 'usage', score: null, weight: 35, deduction: 0, available: false });
    expect(result.motivo).toEqual({ code: 'completeness', label: 'Onboarding incompleto' });
  });

  it('the motivo is the signal that subtracts most', () => {
    const result = saludIndex({ ...healthy, payment: 75, usage: { score: 50, frequency: 50, adoption: 50 }, completeness: 0 }, config);
    // deductions: payment 11.1, usage 19.4, completeness 16.7
    expect(result.motivo?.code).toBe('low_usage');
  });

  it('names low adoption when the active staff share is the weaker half of usage', () => {
    const result = saludIndex({ ...healthy, usage: { score: 40, frequency: 60, adoption: 20 } }, config);
    expect(result.motivo).toEqual({ code: 'low_adoption', label: 'Baja adopción' });
    const frequencyWeaker = saludIndex({ ...healthy, usage: { score: 40, frequency: 20, adoption: 60 } }, config);
    expect(frequencyWeaker.motivo).toEqual({ code: 'low_usage', label: 'Uso muy bajo' });
    const even = saludIndex({ ...healthy, usage: { score: 40, frequency: 40, adoption: 40 } }, config);
    expect(even.motivo?.code).toBe('low_usage');
  });

  it('breaks ties by a fixed order: payment, usage, completeness, support', () => {
    // payment 85 → 40·15 = 600; completeness 60 → 15·40 = 600
    const tie = saludIndex({ ...healthy, payment: 85, completeness: 60 }, config);
    expect(tie.signals[0].deduction).toBe(tie.signals[2].deduction);
    expect(tie.motivo?.code).toBe('payment');
    // usage 70 → 35·30 = 1050; completeness 30 → 15·70 = 1050
    const tie2 = saludIndex({ ...healthy, usage: { score: 70, frequency: 70, adoption: 70 }, completeness: 30 }, config);
    expect(tie2.motivo?.code).toBe('low_usage');
  });
});

describe('isAtRisk', () => {
  it('is true strictly below the threshold, never for Cancelado or without salud', () => {
    expect(isAtRisk(69.9, 'Activo', config)).toBe(true);
    expect(isAtRisk(70, 'Activo', config)).toBe(false);
    expect(isAtRisk(10, 'Cancelado', config)).toBe(false);
    expect(isAtRisk(null, 'Activo', config)).toBe(false);
    expect(isAtRisk(10, 'En prueba', config)).toBe(true);
    expect(isAtRisk(10, 'Suspendido', config)).toBe(true);
  });

  it('with the default weights one serious problem alone is enough, an incomplete setup alone is not', () => {
    expect(saludIndex({ ...healthy, payment: 0 }, config).salud).toBeLessThan(70);
    expect(saludIndex({ ...healthy, payment: 25 }, config).salud).toBeLessThan(70);
    expect(saludIndex({ ...healthy, usage: { score: 0, frequency: 0, adoption: 0 } }, config).salud).toBeLessThan(70);
    expect(saludIndex({ ...healthy, completeness: 0 }, config).salud).toBeGreaterThanOrEqual(70);
  });
});

describe('attentionReasons', () => {
  const now = new Date('2026-10-30T10:00:00Z');
  const base = {
    clientStatus: 'Activo' as const,
    paymentStatus: 'Al día' as const,
    usageScore: 100 as number | null,
    onboardingComplete: true,
    createdAt: day('2026-01-01'),
    seriousTickets: null as number | null,
    now,
  };

  it('none for a healthy despacho', () => {
    expect(attentionReasons(base, config)).toEqual([]);
  });

  it('pagos vencidos for Vencido and Fallido, not for Pendiente', () => {
    const expected = [{ code: 'overdue_payment', label: 'Pagos vencidos', severity: 3 }];
    expect(attentionReasons({ ...base, paymentStatus: 'Vencido' }, config)).toEqual(expected);
    expect(attentionReasons({ ...base, paymentStatus: 'Fallido' }, config)).toEqual(expected);
    expect(attentionReasons({ ...base, paymentStatus: 'Pendiente' }, config)).toEqual([]);
  });

  it('baja actividad below the configured usage score, never during the grace period', () => {
    expect(attentionReasons({ ...base, usageScore: 39.9 }, config)).toEqual([{ code: 'low_activity', label: 'Baja actividad', severity: 2 }]);
    expect(attentionReasons({ ...base, usageScore: 40 }, config)).toEqual([]);
    expect(attentionReasons({ ...base, usageScore: null }, config)).toEqual([]);
  });

  it('onboarding bloqueado once required steps are still pending 14 days after signup', () => {
    const blocked = [{ code: 'onboarding_blocked', label: 'Onboarding bloqueado', severity: 1 }];
    expect(attentionReasons({ ...base, onboardingComplete: false, createdAt: new Date('2026-10-16T10:00:00Z') }, config)).toEqual(blocked);
    expect(attentionReasons({ ...base, onboardingComplete: false, createdAt: new Date('2026-10-16T10:00:01Z') }, config)).toEqual([]);
    expect(attentionReasons({ ...base, clientStatus: 'En prueba', onboardingComplete: false, createdAt: day('2026-10-01') }, config)).toEqual(blocked);
  });

  it('incidencias graves only once support exists and has serious open tickets', () => {
    expect(attentionReasons({ ...base, seriousTickets: null }, config)).toEqual([]);
    expect(attentionReasons({ ...base, seriousTickets: 0 }, config)).toEqual([]);
    expect(attentionReasons({ ...base, seriousTickets: 2 }, config)).toEqual([{ code: 'serious_tickets', label: 'Incidencias graves sin resolver', severity: 3 }]);
  });

  it('lists every reason by severity', () => {
    const reasons = attentionReasons({ ...base, paymentStatus: 'Vencido', usageScore: 0, onboardingComplete: false, createdAt: day('2026-01-01') }, config);
    expect(reasons.map((r) => r.code)).toEqual(['overdue_payment', 'low_activity', 'onboarding_blocked']);
  });

  it('a Cancelado despacho never needs attention', () => {
    expect(attentionReasons({ ...base, clientStatus: 'Cancelado', paymentStatus: 'Vencido', usageScore: 0, onboardingComplete: false }, config)).toEqual([]);
  });
});

describe('compareAttention', () => {
  const item = (name: string, severities: number[], salud: number | null) => ({
    name,
    salud,
    reasons: severities.map((severity) => ({ code: 'x', label: 'x', severity })),
  });

  it('sorts by highest severity, then number of reasons, then lowest salud, then name', () => {
    const list = [
      item('Zeta', [1], 20),
      item('Beta', [2, 1], 50),
      item('Alfa', [2], 10),
      item('Gamma', [3], 90),
      item('Delta', [2, 1], 30),
      item('Épsilon', [2, 1], 30),
      item('Sin salud', [2, 1], null),
    ];
    expect([...list].sort(compareAttention).map((i) => i.name)).toEqual(['Gamma', 'Delta', 'Épsilon', 'Beta', 'Sin salud', 'Alfa', 'Zeta']);
  });
});
