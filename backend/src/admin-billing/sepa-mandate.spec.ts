import {
  SEPA_MANDATE_TEXT_VERSION,
  generateMandateReference,
  isMandateReferenceFor,
  isValidSepaCreditorId,
  normalizeSepaCreditorId,
  sepaMandateText,
} from './sepa-mandate';

const ADMIN_ID = '1a2b3c4d-0000-4000-8000-000000000001';

describe('SEPA creditor identifier (AT-02)', () => {
  it('accepts the EPC example and a Spanish identifier with correct check digits', () => {
    expect(isValidSepaCreditorId('DE98ZZZ09999999999')).toBe(true);
    expect(isValidSepaCreditorId('ES11ZZZB12345674')).toBe(true);
    // The creditor business code (positions 5-7) is excluded from the check.
    expect(isValidSepaCreditorId('ES11001B12345674')).toBe(true);
    expect(isValidSepaCreditorId(' es11 zzz b12345674 ')).toBe(true);
  });

  it('rejects wrong check digits, short values and garbage', () => {
    expect(isValidSepaCreditorId('ES12ZZZB12345674')).toBe(false);
    expect(isValidSepaCreditorId('ES11ZZZ')).toBe(false);
    expect(isValidSepaCreditorId('')).toBe(false);
    expect(isValidSepaCreditorId('not-an-id')).toBe(false);
  });

  it('normalises to upper case without spaces', () => {
    expect(normalizeSepaCreditorId(' es11 zzz b12345674 ')).toBe('ES11ZZZB12345674');
  });
});

describe('mandate reference (UMR)', () => {
  it('is DOM-<8 of the despacho>-<YYYYMMDD>-<6 hex>, at most 35 characters and different every time', () => {
    const at = new Date(Date.UTC(2026, 9, 27, 10));
    const a = generateMandateReference(ADMIN_ID, at);
    const b = generateMandateReference(ADMIN_ID, at);
    expect(a).toMatch(/^DOM-1A2B3C4D-20261027-[0-9A-F]{6}$/);
    expect(a.length).toBeLessThanOrEqual(35);
    expect(a).not.toBe(b);
  });

  it('only belongs to the despacho whose id it carries', () => {
    const ref = generateMandateReference(ADMIN_ID, new Date());
    expect(isMandateReferenceFor(ADMIN_ID, ref)).toBe(true);
    expect(isMandateReferenceFor('99999999-0000-4000-8000-000000000001', ref)).toBe(false);
    expect(isMandateReferenceFor(ADMIN_ID, 'DOM-1A2B3C4D-2026-XYZ')).toBe(false);
  });
});

describe('sepaMandateText', () => {
  it('is the standard SEPA CORE order in Spain Spanish with the creditor identifier and the reference', () => {
    const text = sepaMandateText({
      reference: 'DOM-1A2B3C4D-20261027-ABCDEF',
      creditorId: 'ES11ZZZB12345674',
      creditorName: 'Domora S.L.',
      creditorAddress: 'Calle Mayor 1, 28001 Madrid',
    });
    expect(text).toContain('Orden de domiciliación de adeudo directo SEPA');
    expect(text).toContain('Referencia de la orden de domiciliación: DOM-1A2B3C4D-20261027-ABCDEF');
    expect(text).toContain('Identificador del acreedor: ES11ZZZB12345674');
    expect(text).toContain('Nombre del acreedor: Domora S.L.');
    expect(text).toContain('Dirección: Calle Mayor 1, 28001 Madrid');
    expect(text).toContain('el deudor autoriza (A) al acreedor a enviar instrucciones a la entidad del deudor para adeudar su cuenta');
    expect(text).toContain('dentro de las ocho semanas');
    expect(text).toContain('Tipo de pago: pago recurrente');
    expect(SEPA_MANDATE_TEXT_VERSION).toBe('sepa-core-es-v1');
  });
});
