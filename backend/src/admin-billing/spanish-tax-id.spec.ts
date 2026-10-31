import { isValidSpanishTaxId, normalizeSpanishTaxId } from './spanish-tax-id';

describe('isValidSpanishTaxId (recipient NIF sent to the AEAT on Domora invoices)', () => {
  it.each([
    ['B12345674', 'CIF of an S.L., numeric control digit'],
    ['Q2826000H', 'CIF of a public body, letter control'],
    ['12345678Z', 'DNI'],
    ['X1234567L', 'NIE'],
    ['b-1234567.4', 'CIF written with separators and lower case'],
  ])('accepts %s (%s)', (value) => {
    expect(isValidSpanishTaxId(value)).toBe(true);
  });

  it.each([
    ['B12345678', 'CIF with a wrong control digit'],
    ['B1234567D', 'S.L. whose control must be a digit, not a letter'],
    [
      'Q2826000 8'.replace(' ', ''),
      'public body whose control must be a letter',
    ],
    ['12345678A', 'DNI with a wrong letter'],
    ['I1234567A', 'unknown CIF letter'],
    ['', 'empty'],
    ['ESB12345674', 'intra-community VAT number, not a NIF'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidSpanishTaxId(value)).toBe(false);
  });

  it('normalises to upper case without separators', () => {
    expect(normalizeSpanishTaxId(' b-1234567.4 ')).toBe('B12345674');
  });
});
