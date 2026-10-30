import {
  extractInvoiceText,
  sniffInvoice,
  validateInvoice,
  isDeterministicallyComplete,
} from './invoice-extraction';
const text =
  'Proveedor: Ascensores Centro SL\nCIF: B12345678\nFactura nº: F-100\nFecha factura: 2026-10-01\nBase imponible: 1.000,00 EUR\nIVA: 210,00 EUR\nTotal factura: 1.210,00 EUR\n';
describe('Deterministic invoice extraction', () => {
  it('reads explicit labels and euro formatting', () => {
    const v = extractInvoiceText(text);
    expect(v.total_amount).toBe('1210.00');
    expect(v.invoice_number).toBe('F-100');
    expect(isDeterministicallyComplete(v)).toBe(true);
  });
  it('keeps unknown values null', () => {
    const v = extractInvoiceText('documento ilegible');
    expect(v.total_amount).toBeNull();
    expect(v.supplier_name).toBeNull();
    expect(v.needs_review).toBe(true);
  });
  it('flags arithmetic inconsistencies', () =>
    expect(
      validateInvoice({ ...extractInvoiceText(text), total_amount: '1211.00' }),
    ).toContain('total_does_not_equal_net_plus_vat'));
  it('does not invent a missing currency', () =>
    expect(
      validateInvoice({ ...extractInvoiceText(text), currency: null }),
    ).toContain('currency_missing_or_not_eur'));
  it('requires manual review of credit notes', () =>
    expect(
      validateInvoice({ ...extractInvoiceText(text), total_amount: '-100.00' }),
    ).toContain('credit_note_requires_manual_posting'));
  it('rejects fabricated calendar dates', () =>
    expect(
      validateInvoice({
        ...extractInvoiceText(text),
        invoice_date: '2026-02-30',
      }),
    ).toContain('invalid_invoice_date'));
  it('does not accept executable bytes as a PDF', () =>
    expect(sniffInvoice(Buffer.from('MZnot-a-pdf'))).toBeNull());
  it('recognizes PDF content from its signature', () =>
    expect(sniffInvoice(Buffer.from('%PDF-1.7'))).toBe('application/pdf'));
});
