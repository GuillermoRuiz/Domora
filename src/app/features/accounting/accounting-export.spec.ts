import { accountingCsv } from './accounting-export';
import { AccountingEstate } from '../../core/models';

const estate: AccountingEstate = {
  id: 'e1',
  administratorId: 'a1',
  name: 'Edificio Sol',
  type: 'Edificio',
  balance: 1234.56,
  income: 200,
  expenses: 100,
  reserve: 300,
  reserveTarget: 500,
  delinquency: 20.5,
  units: 10,
  address: 'Calle Mayor',
  streetNumber: '12',
  location: 'Madrid',
};

describe('accountingCsv', () => {
  it('exporta los importes reales con céntimos y dirección, y preserva el orden de las comunidades', () => {
    const csv = accountingCsv([
      estate,
      { ...estate, id: 'e2', name: 'Otra comunidad', balance: -10 },
    ]);
    expect(csv.startsWith('\uFEFFComunidad;Dirección;')).toBe(true);
    const rows = csv.split('\r\n');
    expect(rows[1]).toBe(
      '"Edificio Sol";"Calle Mayor 12, Madrid";1234,56;200,00;100,00;300,00;20,50',
    );
    expect(rows[2]).toContain(';\u002d10,00;');
  });

  it('escapa comillas y evita ejecutar nombres o direcciones como fórmulas en Excel', () => {
    const csv = accountingCsv([
      {
        ...estate,
        name: '=HYPERLINK("x")',
        address: '  +1',
        streetNumber: '',
        location: '',
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"\'  +1"');
  });
});
