import {
  allocateCollection,
  legalImputationOrder,
  receiptStatusFor,
  type OpenReceipt,
} from './collection.rules';

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

function r(id: string, overrides: Partial<OpenReceipt> = {}): OpenReceipt {
  return {
    id,
    kind: 'cuota_ordinaria',
    outstanding: 10000,
    originYear: 2026,
    accrualDate: D('2026-03-01'),
    dueDate: D('2026-03-05'),
    no: id,
    ...overrides,
  };
}

describe('legalImputationOrder (arts. 1173 y 1174 CC)', () => {
  it('intereses primero, después lo más antiguo por año de origen y fecha', () => {
    const ordered = legalImputationOrder([
      r('marzo-2026', { accrualDate: D('2026-03-01') }),
      r('intereses', {
        kind: 'intereses_demora',
        originYear: 2026,
        accrualDate: D('2026-06-01'),
      }),
      r('nov-2025', { originYear: 2025, accrualDate: D('2026-01-01') }),
      r('enero-2026', { accrualDate: D('2026-01-01') }),
    ]);
    expect(ordered.map((x) => x.id)).toEqual([
      'intereses',
      'nov-2025',
      'enero-2026',
      'marzo-2026',
    ]);
  });
});

describe('allocateCollection', () => {
  it('cubre recibos en orden y deja el resto a medias', () => {
    const result = allocateCollection(15000, [
      r('b', { accrualDate: D('2026-04-01') }),
      r('a'),
    ]);
    expect(result).toEqual({
      allocations: [
        { receiptId: 'a', amount: 10000 },
        { receiptId: 'b', amount: 5000 },
      ],
      advance: 0,
    });
  });

  it('lo que sobra es un anticipo', () => {
    expect(allocateCollection(12500, [r('a')])).toEqual({
      allocations: [{ receiptId: 'a', amount: 10000 }],
      advance: 2500,
    });
    expect(allocateCollection(3000, [])).toEqual({
      allocations: [],
      advance: 3000,
    });
  });

  it('respeta el orden que indica la gestora', () => {
    const result = allocateCollection(
      10000,
      [r('a'), r('b', { accrualDate: D('2026-04-01') })],
      ['b'],
    );
    expect(result.allocations).toEqual([{ receiptId: 'b', amount: 10000 }]);
  });

  it('un recibo indicado que no está pendiente es un error', () => {
    expect(() => allocateCollection(100, [r('a')], ['otro'])).toThrow(
      /no está pendiente/,
    );
  });

  it('la suma imputada más el anticipo es siempre el cobro', () => {
    for (const amount of [1, 999, 10000, 25001, 40000]) {
      const res = allocateCollection(amount, [
        r('a', { outstanding: 7777 }),
        r('b', { outstanding: 12345 }),
      ]);
      expect(
        res.allocations.reduce((s, a) => s + a.amount, 0) + res.advance,
      ).toBe(amount);
    }
  });

  it('rechaza importes no positivos o con fracción de céntimo', () => {
    expect(() => allocateCollection(0, [r('a')])).toThrow();
    expect(() => allocateCollection(10.5, [r('a')])).toThrow();
  });
});

describe('receiptStatusFor', () => {
  it.each([
    [10000, 0, {}, 'Pagada'],
    [10000, 10000, {}, 'Pendiente'],
    [10000, 4000, {}, 'Parcial'],
    [10000, 10000, { returned: true }, 'Devuelto'],
    [10000, 10000, { previous: 'Devuelto' as const }, 'Devuelto'],
    [10000, 4000, { previous: 'Devuelto' as const }, 'Parcial'],
  ])(
    'importe %i, pendiente %i, %j → %s',
    (amount, outstanding, opts, expected) => {
      expect(receiptStatusFor(amount, outstanding, opts)).toBe(expected);
    },
  );
});
