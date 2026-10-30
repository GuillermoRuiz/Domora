import {
  closingLine,
  computeReserveAllocation,
  openingLine,
} from './year-close.rules';

describe('closingLine / openingLine', () => {
  it('saldo cero no genera ninguna línea', () => {
    expect(closingLine('acc-1', 0)).toBeNull();
    expect(openingLine('acc-1', 0)).toBeNull();
  });

  it('saldo deudor (positivo): se abona para cerrar, se carga para reabrir', () => {
    expect(closingLine('acc-1', 1000)).toEqual({
      account: { accountId: 'acc-1' },
      credit: 1000,
    });
    expect(openingLine('acc-1', 1000)).toEqual({
      account: { accountId: 'acc-1' },
      debit: 1000,
    });
  });

  it('saldo acreedor (negativo): se carga para cerrar, se abona para reabrir', () => {
    expect(closingLine('acc-1', -500)).toEqual({
      account: { accountId: 'acc-1' },
      debit: 500,
    });
    expect(openingLine('acc-1', -500)).toEqual({
      account: { accountId: 'acc-1' },
      credit: 500,
    });
  });

  it('conserva las dimensiones extra (propiedad, recibo...)', () => {
    expect(
      closingLine('acc-430', 200, { propertyId: 'p1', receiptId: 'r1' }),
    ).toEqual({
      account: { accountId: 'acc-430' },
      credit: 200,
      propertyId: 'p1',
      receiptId: 'r1',
    });
  });
});

describe('computeReserveAllocation', () => {
  const base = {
    resultCents: 100_000, // 1.000€ de beneficio
    currentReserveCents: 50_000, // 500€ ya en la 117
    legalMinimumCents: 80_000, // 800€ mínimo legal
  };

  it('con pérdidas, nunca dota nada', () => {
    const cents = computeReserveAllocation({
      ...base,
      rule: 'fixed_amount',
      value: 100,
      resultCents: -50_000,
    });
    expect(cents).toBe(0);
  });

  it('fixed_amount: el importe fijo, salvo que supere el resultado', () => {
    expect(
      computeReserveAllocation({ ...base, rule: 'fixed_amount', value: 300 }),
    ).toBe(30_000);
    // El resultado es 1.000€: un fijo de 2.000€ se recorta a 1.000€.
    expect(
      computeReserveAllocation({ ...base, rule: 'fixed_amount', value: 2000 }),
    ).toBe(100_000);
  });

  it('pct_of_result: el porcentaje exacto del resultado', () => {
    expect(
      computeReserveAllocation({ ...base, rule: 'pct_of_result', value: 25 }),
    ).toBe(25_000);
  });

  it('top_up_to_legal_minimum: justo lo que falta hasta el mínimo', () => {
    // Faltan 300€ (800 - 500) para el mínimo, y el resultado (1.000€) alcanza de sobra.
    expect(
      computeReserveAllocation({
        ...base,
        rule: 'top_up_to_legal_minimum',
        value: null,
      }),
    ).toBe(30_000);
  });

  it('top_up_to_legal_minimum: si ya se cumple el mínimo, no dota nada', () => {
    expect(
      computeReserveAllocation({
        ...base,
        rule: 'top_up_to_legal_minimum',
        value: null,
        currentReserveCents: 90_000,
      }),
    ).toBe(0);
  });

  it('top_up_to_legal_minimum: nunca dota más de lo que da el resultado', () => {
    // Faltarían 750€ para el mínimo, pero el resultado solo da 100€.
    expect(
      computeReserveAllocation({
        ...base,
        rule: 'top_up_to_legal_minimum',
        value: null,
        currentReserveCents: 5_000,
        resultCents: 10_000,
      }),
    ).toBe(10_000);
  });
});
