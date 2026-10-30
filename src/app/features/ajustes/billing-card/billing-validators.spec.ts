import { isValidIban, isValidSpanishTaxId } from './billing-validators';

describe('billing validators (mirror of the backend checks)', () => {
  it('NIF/CIF: accepts CIF, DNI and NIE with their check digit, rejects a wrong one', () => {
    expect(isValidSpanishTaxId('B12345674')).toBe(true);
    expect(isValidSpanishTaxId('Q2826000H')).toBe(true);
    expect(isValidSpanishTaxId('12345678Z')).toBe(true);
    expect(isValidSpanishTaxId('X1234567L')).toBe(true);
    expect(isValidSpanishTaxId('b-1234567.4')).toBe(true);
    expect(isValidSpanishTaxId('B12345678')).toBe(false);
    expect(isValidSpanishTaxId('B1234567D')).toBe(false);
    expect(isValidSpanishTaxId('')).toBe(false);
  });

  it('IBAN: checks the ISO 13616 check digits, ignoring spaces and case', () => {
    expect(isValidIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
    expect(isValidIban('es9121000418450200051332')).toBe(true);
    expect(isValidIban('ES9121000418450200051333')).toBe(false);
    expect(isValidIban('ES91')).toBe(false);
  });
});
