import type { InvoiceExtraction } from './ai.types';
const amount = (s: string | undefined): string | null => {
  if (!s) return null;
  let v = s.trim().replace(/\s/g, '');
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(v)) return null;
  const [whole, decimal = ''] = v.split('.');
  return `${whole}.${decimal.padEnd(2, '0')}`;
};
export function extractInvoiceText(text: string): InvoiceExtraction {
  const grab = (pattern: RegExp) => pattern.exec(text)?.[1]?.trim() ?? null;
  const getAmount = (label: string) =>
    amount(
      new RegExp(
        `(?:^|\\n)\\s*(?:${label})\\s*[:=]?\\s*(-?[\\d .]+(?:[,.]\\d{2}))\\s*(?:€|EUR)?\\s*(?:\\n|$)`,
        'i',
      ).exec(text)?.[1],
    );
  const rawDate = grab(
    /(?:fecha de factura|fecha factura|invoice date)\s*:\s*(\d{4}-\d{2}-\d{2})/i,
  );
  return {
    supplier_name: grab(
      /(?:proveedor|razón social|supplier)\s*:\s*([^\n]{1,200})/i,
    ),
    supplier_tax_id: grab(/(?:CIF|NIF|VAT ID)\s*:\s*([A-Z0-9-]{8,20})/i),
    invoice_number: grab(
      /(?:factura n[ºo°.]?|invoice number)\s*:\s*([A-Z0-9/-]{1,60})/i,
    ),
    invoice_date: rawDate,
    due_date: grab(/(?:vencimiento|due date)\s*:\s*(\d{4}-\d{2}-\d{2})/i),
    description: null,
    net_amount: getAmount('base imponible|net amount'),
    vat_amount: getAmount('importe IVA|IVA|VAT amount'),
    total_amount: getAmount('total factura|invoice total'),
    withholding_amount: getAmount('retención|IRPF|withholding'),
    currency: /\bEUR\b|€/.test(text) ? 'EUR' : null,
    payment_reference: null,
    needs_review: true,
  };
}
const cents = (s: string) => {
  const negative = s.startsWith('-');
  const [a, b] = s.replace('-', '').split('.');
  const n = Number(a) * 100 + Number(b);
  if (!Number.isSafeInteger(n)) throw new Error('INVOICE_AMOUNT_INVALID');
  return negative ? -n : n;
};
export function validateInvoice(value: InvoiceExtraction): string[] {
  const warnings: string[] = [];
  for (const field of ['invoice_date', 'due_date'] as const) {
    const date = value[field];
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      warnings.push(`invalid_${field}`);
  }
  for (const field of [
    'net_amount',
    'vat_amount',
    'total_amount',
    'withholding_amount',
  ] as const)
    if (value[field] && !/^-?\d{1,10}\.\d{2}$/.test(value[field]!))
      throw new Error('INVOICE_AMOUNT_INVALID');
  if (
    value.net_amount !== null &&
    value.vat_amount !== null &&
    value.total_amount !== null &&
    cents(value.net_amount) + cents(value.vat_amount) !==
      cents(value.total_amount)
  )
    warnings.push('total_does_not_equal_net_plus_vat');
  if (value.currency !== 'EUR') warnings.push('currency_missing_or_not_eur');
  if (
    !value.supplier_tax_id ||
    !value.invoice_number ||
    !value.invoice_date ||
    value.total_amount === null
  )
    warnings.push('required_fields_missing');
  if (value.total_amount && cents(value.total_amount) < 0)
    warnings.push('credit_note_requires_manual_posting');
  if (value.withholding_amount !== null)
    warnings.push('review_withholding_and_payable');
  return warnings;
}
export function isDeterministicallyComplete(value: InvoiceExtraction): boolean {
  return (
    validateInvoice(value).length === 0 &&
    value.net_amount !== null &&
    value.vat_amount !== null
  );
}
export function sniffInvoice(
  bytes: Buffer,
): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}
