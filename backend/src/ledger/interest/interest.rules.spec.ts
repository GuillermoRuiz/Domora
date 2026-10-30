import { computeInterest, type InterestPolicyWindow } from './interest.rules';

const D = (s: string) => new Date(`${s}T00:00:00Z`);

function policy(
  overrides: Partial<InterestPolicyWindow> = {},
): InterestPolicyWindow {
  return {
    id: 'pol-1',
    annualRatePct: '3.65', // truco: 3.65/100/365 = 0.0001 exacto por día, útil para verificar a mano.
    graceDays: 0,
    validFrom: D('2020-01-01'),
    validTo: null,
    ...overrides,
  };
}

describe('computeInterest', () => {
  it('interés simple básico: 1.000€ al 3,65% anual, 100 días reales = 10,00€', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-04-11'), // 100 días desde el 1/1
      policies: [policy()],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.interestStart).toEqual(D('2026-01-01'));
    expect(result.totalCents).toBe(1_000); // 100.000 * 3,65% * 100/365 = 1.000 céntimos
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].days).toBe(100);
  });

  it('días de gracia retrasan el inicio del devengo', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-01-20'),
      policies: [policy({ graceDays: 10 })],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.interestStart).toEqual(D('2026-01-11'));
    expect(result.segments[0].days).toBe(9); // del 11 al 20
  });

  it('si todavía no pasó la carencia, no hay nada que liquidar', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-01-05'),
      policies: [policy({ graceDays: 10 })],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.totalCents).toBe(0);
    expect(result.segments).toHaveLength(0);
  });

  it('cambio de tipo a mitad de periodo genera un tramo por cada tipo', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-03-01'), // 59 días (enero 31 + febrero 28, 2026 no es bisiesto)
      policies: [
        policy({
          id: 'pol-old',
          annualRatePct: '3.65',
          validFrom: D('2020-01-01'),
          validTo: D('2026-02-01'),
        }),
        policy({
          id: 'pol-new',
          annualRatePct: '7.30',
          validFrom: D('2026-02-01'),
          validTo: null,
        }),
      ],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ policyId: 'pol-old', days: 31 });
    expect(result.segments[1]).toMatchObject({ policyId: 'pol-new', days: 28 });
    // 100.000 * 3,65% * 31/365 = 310; 100.000 * 7,30% * 28/365 = 560
    expect(result.segments[0].amountCents).toBe(310);
    expect(result.segments[1].amountCents).toBe(560);
    expect(result.totalCents).toBe(870);
  });

  it('un cobro parcial a mitad de periodo reduce el principal desde ese día', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-03-01'), // 59 días
      policies: [policy()],
      principalTimeline: [
        { from: D('2026-01-01'), outstandingCents: 100_000 },
        { from: D('2026-01-31'), outstandingCents: 40_000 }, // se cobran 600€ el día 31
      ],
      alreadyLiquidated: [],
    });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      principalCents: 100_000,
      days: 30,
    });
    expect(result.segments[1]).toMatchObject({
      principalCents: 40_000,
      days: 29,
    });
  });

  it('no vuelve a liquidar un tramo ya liquidado (garantía T11)', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-03-01'),
      policies: [policy()],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [{ from: D('2026-01-01'), to: D('2026-02-01') }],
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].from).toEqual(D('2026-02-01'));
    expect(result.segments[0].to).toEqual(D('2026-03-01'));
  });

  it('un hueco sin política configurada no inventa un tipo: se salta ese tramo', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-03-01'),
      policies: [
        policy({ validFrom: D('2020-01-01'), validTo: D('2026-01-15') }),
        policy({ id: 'pol-later', validFrom: D('2026-02-01'), validTo: null }),
      ],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    // Del 1 al 15/1 hay política; del 15/1 al 1/2 NO hay ninguna (hueco); del 1/2 en adelante sí.
    expect(result.segments.map((s) => s.policyId)).toEqual([
      'pol-1',
      'pol-later',
    ]);
  });

  it('año bisiesto: el 29 de febrero cuenta como día real, pero el divisor sigue siendo 365', () => {
    const result = computeInterest({
      dueDate: D('2028-02-01'), // 2028 es bisiesto
      asOfDate: D('2028-03-01'), // 29 días (incluye el 29/2)
      policies: [policy()],
      principalTimeline: [{ from: D('2028-02-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.segments[0].days).toBe(29);
    // 100.000 * 3,65% * 29/365 = 290 (si dividiera por 366 daría menos)
    expect(result.segments[0].amountCents).toBe(290);
  });

  it('sin ninguna política aplicable, no hay carencia ni devengo', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-06-01'),
      policies: [],
      principalTimeline: [{ from: D('2026-01-01'), outstandingCents: 100_000 }],
      alreadyLiquidated: [],
    });
    expect(result.interestStart).toBeNull();
    expect(result.totalCents).toBe(0);
  });

  it('principal a cero (deuda ya cobrada del todo) no genera importe', () => {
    const result = computeInterest({
      dueDate: D('2026-01-01'),
      asOfDate: D('2026-03-01'),
      policies: [policy()],
      principalTimeline: [
        { from: D('2026-01-01'), outstandingCents: 100_000 },
        { from: D('2026-01-15'), outstandingCents: 0 },
      ],
      alreadyLiquidated: [],
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].to).toEqual(D('2026-01-15'));
  });
});
