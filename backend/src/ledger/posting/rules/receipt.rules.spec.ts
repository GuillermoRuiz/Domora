import {
  collectionAccountRole,
  LEGAL_MINIMUM_RESERVE_SHARE_PCT,
  receiptAccrualDate,
  receiptCreditLines,
} from './receipt.rules';

const sum = (lines: { amount: number }[]) =>
  lines.reduce((a, l) => a + l.amount, 0);

describe('receiptCreditLines — desglose de la emisión', () => {
  it('cuota ordinaria sin reserva por recibo: todo a la 700', () => {
    expect(
      receiptCreditLines('cuota_ordinaria', 8750, {
        mode: 'year_end_allocation',
        sharePct: '10',
      }),
    ).toEqual([
      { role: 'income_ordinary', amount: 8750, concept: 'Cuota ordinaria' },
    ]);
    expect(
      receiptCreditLines('cuota_ordinaria', 8750, {
        mode: 'receipt_share',
        sharePct: null,
      }),
    ).toHaveLength(1);
    expect(
      receiptCreditLines('cuota_ordinaria', 8750, {
        mode: 'none',
        sharePct: '10',
      }),
    ).toHaveLength(1);
  });

  it('modo "por recibo": la parte de la reserva va a la 117 y la cuota se queda con el resto', () => {
    const lines = receiptCreditLines('cuota_ordinaria', 10000, {
      mode: 'receipt_share',
      sharePct: '10',
    });
    expect(lines).toEqual([
      { role: 'income_ordinary', amount: 9000, concept: 'Cuota ordinaria' },
      {
        role: 'reserve_fund',
        amount: 1000,
        concept: 'Aportación al fondo de reserva',
      },
    ]);
  });

  it('el modo "ambos" también separa la reserva en cada recibo', () => {
    expect(
      receiptCreditLines('cuota_ordinaria', 10000, {
        mode: 'both',
        sharePct: '5',
      }).map((l) => l.amount),
    ).toEqual([9500, 500]);
  });

  it('el redondeo nunca pierde ni inventa un céntimo', () => {
    for (const amount of [1, 3, 3333, 8750, 12345, 99999]) {
      for (const pct of ['9.10', '10', '33.33', '0.01']) {
        const lines = receiptCreditLines('cuota_ordinaria', amount, {
          mode: 'receipt_share',
          sharePct: pct,
        });
        expect(sum(lines)).toBe(amount);
        expect(
          lines.every((l) => l.amount > 0 && Number.isInteger(l.amount)),
        ).toBe(true);
      }
    }
  });

  it('33,33 € al 9,10 %: 3,03 € a la reserva (medio céntimo hacia arriba) y 30,30 € de cuota', () => {
    expect(
      receiptCreditLines('cuota_ordinaria', 3333, {
        mode: 'receipt_share',
        sharePct: '9.10',
      }).map((l) => l.amount),
    ).toEqual([3030, 303]);
  });

  it('las derramas y los demás tipos no separan reserva', () => {
    expect(
      receiptCreditLines('derrama', 50000, {
        mode: 'receipt_share',
        sharePct: '10',
      }),
    ).toEqual([
      { role: 'income_extraordinary', amount: 50000, concept: 'Derrama' },
    ]);
    expect(
      receiptCreditLines('fondo_reserva', 2000, {
        mode: 'receipt_share',
        sharePct: '10',
      })[0].role,
    ).toBe('reserve_fund');
    expect(
      receiptCreditLines('intereses_demora', 150, {
        mode: 'receipt_share',
        sharePct: '10',
      })[0].role,
    ).toBe('interest_income');
    expect(
      receiptCreditLines('gastos_devolucion', 300, {
        mode: 'none',
        sharePct: null,
      })[0].role,
    ).toBe('income_recharges');
    expect(
      receiptCreditLines('otros', 300, { mode: 'none', sharePct: null })[0]
        .role,
    ).toBe('income_recharges');
  });

  it('un 100 % de reserva manda todo a la 117 sin línea de cuota a cero', () => {
    expect(
      receiptCreditLines('cuota_ordinaria', 500, {
        mode: 'receipt_share',
        sharePct: '100',
      }),
    ).toEqual([
      {
        role: 'reserve_fund',
        amount: 500,
        concept: 'Aportación al fondo de reserva',
      },
    ]);
  });

  it('rechaza importes no positivos y el saldo anterior (que no tiene desglose)', () => {
    expect(() =>
      receiptCreditLines('cuota_ordinaria', 0, {
        mode: 'none',
        sharePct: null,
      }),
    ).toThrow();
    expect(() =>
      receiptCreditLines('cuota_ordinaria', 10.5, {
        mode: 'none',
        sharePct: null,
      }),
    ).toThrow();
    expect(() =>
      receiptCreditLines('saldo_anterior', 100, {
        mode: 'none',
        sharePct: null,
      }),
    ).toThrow(/saldo anterior/);
  });
});

describe('otras reglas de recibos', () => {
  it('efectivo y pago en oficina van a caja; lo demás al banco', () => {
    expect(collectionAccountRole('Efectivo')).toBe('cash');
    expect(collectionAccountRole('PagoEnOficina')).toBe('cash');
    expect(collectionAccountRole('Transferencia')).toBe('bank');
    expect(collectionAccountRole('Domiciliacion')).toBe('bank');
    expect(collectionAccountRole('Bizum')).toBe('bank');
  });

  it('la emisión se fecha al inicio del periodo, o a la fecha de corte si es posterior', () => {
    const cutover = new Date('2026-07-01T00:00:00Z');
    expect(
      receiptAccrualDate('2026-09', cutover).toISOString().slice(0, 10),
    ).toBe('2026-09-01');
    expect(
      receiptAccrualDate('2026-03', cutover).toISOString().slice(0, 10),
    ).toBe('2026-07-01');
  });

  it('el porcentaje sugerido cubre el mínimo legal del 10 % del presupuesto', () => {
    // Presupuesto 1.000 €: cuotas = 1.000 / (1 − p). La reserva recaudada
    // debe ser ≥ 100 € (10 %).
    const p = Number(LEGAL_MINIMUM_RESERVE_SHARE_PCT) / 100;
    const collected = 1000 / (1 - p);
    expect(collected * p).toBeGreaterThanOrEqual(100);
  });
});
