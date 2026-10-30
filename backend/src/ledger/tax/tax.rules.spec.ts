import {
  deadline111,
  proratedShare,
  quarterOf,
  quarterRange,
  summarize111,
  summarize190,
  summarize347,
  THRESHOLD_347,
  type Operation347,
  type WithholdingEvent,
} from './tax.rules';

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('trimestres y plazos', () => {
  it('rango, trimestre de una fecha y plazo del 111 (día 20 del mes siguiente)', () => {
    expect(quarterRange(2026, 1)).toEqual({
      from: D('2026-01-01'),
      to: D('2026-03-31'),
    });
    expect(quarterRange(2026, 4)).toEqual({
      from: D('2026-10-01'),
      to: D('2026-12-31'),
    });
    expect(quarterOf(D('2026-06-30'))).toBe(2);
    expect(quarterOf(D('2026-07-01'))).toBe(3);
    expect(iso(deadline111(2026, 1))).toBe('2026-04-20');
    expect(iso(deadline111(2026, 4))).toBe('2027-01-20');
  });
});

describe('proratedShare', () => {
  it('los pagos parciales se reparten la retención sin perder céntimos', () => {
    // Retención 150,00 € de una factura de 1.060,00 € pagada en tres veces.
    const pays = [33333, 33333, 39334];
    let before = 0;
    const shares = pays.map((p) => {
      const s = proratedShare(15000, 106000, before, before + p);
      before += p;
      return s;
    });
    expect(shares.reduce((a, b) => a + b, 0)).toBe(15000);
    expect(shares).toEqual([4717, 4717, 5566]);
  });

  it('pagada de una vez, toda la retención', () => {
    expect(proratedShare(15000, 106000, 0, 106000)).toBe(15000);
  });

  it('rechaza acumulados incoherentes', () => {
    expect(() => proratedShare(100, 1000, 500, 400)).toThrow();
    expect(() => proratedShare(100, 1000, 0, 1001)).toThrow();
  });
});

const ev = (overrides: Partial<WithholdingEvent>): WithholdingEvent => ({
  date: D('2026-02-15'),
  key: 'G',
  recipientKey: 'B1',
  nif: 'B1',
  name: 'Arquitectos',
  perception: 100000,
  withholding: 15000,
  source: 'supplier_payment',
  documentRef: 'F-1',
  ...overrides,
});

describe('summarize111', () => {
  it('separa trabajo (01-03) y actividades (07-09), cuenta perceptores distintos y deja aparte la clave "otra"', () => {
    const s = summarize111([
      ev({}),
      ev({ documentRef: 'F-2', perception: 50000, withholding: 7500 }),
      ev({ recipientKey: 'B2', nif: 'B2', name: 'Abogada' }),
      ev({
        key: 'A',
        recipientKey: '0T',
        nif: '0T',
        name: 'Portero',
        perception: 150000,
        withholding: 15000,
        source: 'payroll',
      }),
      ev({
        key: 'other',
        recipientKey: 'X',
        perception: 80000,
        withholding: 15200,
      }),
    ]);
    expect(s.work).toEqual({
      recipients: 1,
      perceptions: 150000,
      withholdings: 15000,
    });
    expect(s.activities).toEqual({
      recipients: 2,
      perceptions: 250000,
      withholdings: 37500,
    });
    expect(s.total).toBe(52500);
    expect(s.unclassified.withholdings).toBe(15200);
  });
});

describe('summarize190', () => {
  it('una línea por perceptor y clave, con la subclave 01 en la G', () => {
    const rows = summarize190([
      ev({ date: D('2026-02-01') }),
      ev({ date: D('2026-11-01'), perception: 20000, withholding: 3000 }),
      ev({
        key: 'A',
        recipientKey: '0T',
        nif: '0T',
        name: 'Portero',
        perception: 150000,
        withholding: 15000,
      }),
    ]);
    expect(rows).toEqual([
      {
        nif: 'B1',
        name: 'Arquitectos',
        key: 'G',
        subkey: '01',
        perceptions: 120000,
        withholdings: 18000,
      },
      {
        nif: '0T',
        name: 'Portero',
        key: 'A',
        subkey: null,
        perceptions: 150000,
        withholdings: 15000,
      },
    ]);
  });
});

describe('summarize347', () => {
  const op = (overrides: Partial<Operation347>): Operation347 => ({
    thirdPartyId: 's1',
    name: 'Ascensores',
    nif: 'B9',
    date: D('2026-02-01'),
    amount: 200000,
    excludedThirdParty: false,
    withheld: false,
    ...overrides,
  });

  it('declara a quien supera 3.005,06 € con IVA, con el desglose por trimestres', () => {
    const s = summarize347([
      op({}),
      op({ date: D('2026-05-01'), amount: 100507 }),
    ]);
    expect(s.declared).toEqual([
      {
        thirdPartyId: 's1',
        name: 'Ascensores',
        nif: 'B9',
        total: 300507,
        quarters: [200000, 100507, 0, 0],
      },
    ]);
  });

  it('en el umbral exacto no se declara; los excluidos del art. 33.5 y las operaciones con retención quedan fuera', () => {
    const s = summarize347([
      op({ amount: THRESHOLD_347 }),
      op({
        thirdPartyId: 'luz',
        name: 'Eléctrica',
        amount: 900000,
        excludedThirdParty: true,
      }),
      op({
        thirdPartyId: 'arq',
        name: 'Arquitectos',
        amount: 500000,
        withheld: true,
      }),
    ]);
    expect(s.declared).toEqual([]);
    expect(s.excluded.map((e) => [e.name, e.reason])).toEqual([
      ['Arquitectos', 'retencion'],
      ['Ascensores', 'umbral'],
      ['Eléctrica', 'art_33_5'],
    ]);
  });

  it('las facturas con retención de un tercero no suman, pero las demás sí', () => {
    const s = summarize347([
      op({
        thirdPartyId: 'mix',
        name: 'Mixto',
        amount: 400000,
        withheld: true,
      }),
      op({ thirdPartyId: 'mix', name: 'Mixto', amount: 350000 }),
    ]);
    expect(s.declared[0].total).toBe(350000);
  });
});
