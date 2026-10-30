import { bankNameFromIban } from './spanish-banks';

describe('bankNameFromIban', () => {
  it('names the entity of a Spanish IBAN, with or without spaces', () => {
    expect(bankNameFromIban('ES91 2100 0418 4502 0005 1332')).toBe('CaixaBank');
    expect(bankNameFromIban('es7600491500051234567892')).toBe('Banco Santander');
  });
  it('returns null for unknown entities, foreign IBANs and empty values', () => {
    expect(bankNameFromIban('ES9199990418450200051332')).toBeNull();
    expect(bankNameFromIban('DE89370400440532013000')).toBeNull();
    expect(bankNameFromIban(null)).toBeNull();
    expect(bankNameFromIban('')).toBeNull();
  });
});
