import {
  allocatePayment,
  computeInvoice,
  invoiceStatusFor,
  type OpenInvoice,
} from './supplier.rules';

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('computeInvoice', () => {
  it('factura de un profesional: 21 % de IVA y 15 % de retención sobre la base', () => {
    const r = computeInvoice([{ accountId: '623', base: 100000 }], 21, 15);
    expect(r).toMatchObject({
      base: 100000,
      vat: 21000,
      withholding: 15000,
      total: 121000,
      payable: 106000,
    });
    expect(r.lines[0].amount).toBe(121000);
  });

  it('el IVA se reparte entre las líneas por su base y la suma es el total exacto', () => {
    const r = computeInvoice(
      [
        { accountId: '622', base: 3333 },
        { accountId: '622', costCentreId: 'garaje', base: 3333 },
        { accountId: '628', base: 3334 },
      ],
      21,
      0,
    );
    expect(r.vat).toBe(2100);
    expect(r.lines.map((l) => l.amount)).toEqual([4033, 4033, 4034]);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
  });

  it('redondea medio céntimo hacia arriba', () => {
    // 10,50 € × 10 % = 1,05 €; 0,05 € × 21 % = 0,0105 € → 0,01 €.
    expect(computeInvoice([{ accountId: 'a', base: 1050 }], 10, 0).vat).toBe(
      105,
    );
    expect(computeInvoice([{ accountId: 'a', base: 5 }], 21, 0).vat).toBe(1);
    expect(computeInvoice([{ accountId: 'a', base: 2 }], 21, 0).vat).toBe(0);
  });

  it('sin IVA ni retención, la línea carga solo la base', () => {
    const r = computeInvoice([{ accountId: 'a', base: 5000 }], 0, 0);
    expect(r).toMatchObject({
      vat: 0,
      withholding: 0,
      total: 5000,
      payable: 5000,
    });
  });

  it.each([
    [[], 21, 0, /al menos una línea/],
    [[{ accountId: 'a', base: 0 }], 21, 0, /mayor que cero/],
    [[{ accountId: 'a', base: 100 }], 21.555, 0, /IVA/],
    [[{ accountId: 'a', base: 100 }], 0, 101, /retención/],
    [[{ accountId: 'a', base: 100 }], 0, 100, /no puede ser igual o mayor/],
  ])('rechaza datos imposibles (%#)', (lines, vat, wh, message) => {
    expect(() => computeInvoice(lines, vat, wh)).toThrow(message);
  });
});

describe('allocatePayment', () => {
  const inv = (
    id: string,
    outstanding: number,
    due: string | null,
    issue = '2026-01-01',
  ): OpenInvoice => ({
    id,
    number: id,
    outstanding,
    dueDate: due ? D(due) : null,
    issueDate: D(issue),
  });

  it('paga primero lo que vence antes; sin vencimiento, al final', () => {
    const open = [
      inv('sin-venc', 1000, null),
      inv('abril', 1000, '2026-04-30'),
      inv('marzo', 1000, '2026-03-31'),
    ];
    expect(allocatePayment(1500, open)).toEqual([
      { invoiceId: 'marzo', amount: 1000 },
      { invoiceId: 'abril', amount: 500 },
    ]);
  });

  it('respeta las facturas que elige la gestora', () => {
    const open = [inv('a', 1000, '2026-03-31'), inv('b', 1000, '2026-04-30')];
    expect(allocatePayment(1000, open, ['b'])).toEqual([
      { invoiceId: 'b', amount: 1000 },
    ]);
    expect(() => allocatePayment(1000, open, ['c'])).toThrow(
      /no está pendiente/,
    );
  });

  it('no se paga de más a un proveedor', () => {
    expect(() =>
      allocatePayment(2001, [inv('a', 1000, null), inv('b', 1000, null)]),
    ).toThrow(/supera lo pendiente/);
    expect(() =>
      allocatePayment(
        1001,
        [inv('a', 1000, null), inv('b', 1000, null)],
        ['a'],
      ),
    ).toThrow(/esas facturas/);
  });

  it('estado según lo que queda por pagar', () => {
    expect(invoiceStatusFor(1000, 1000)).toBe('Registrada');
    expect(invoiceStatusFor(1000, 400)).toBe('Parcial');
    expect(invoiceStatusFor(1000, 0)).toBe('Pagada');
  });
});
