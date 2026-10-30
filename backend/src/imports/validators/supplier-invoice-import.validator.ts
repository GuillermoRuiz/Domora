import {
  parseSpanishDate,
  parseSpanishDecimal,
  type ValidatedRow,
} from './parsing.util';

/** Factura de proveedor pendiente al arrancar la contabilidad (fase 9) — va al borrador de saldos iniciales, nunca directo al diario. */
export interface SupplierInvoiceImportRow {
  supplierName: string;
  number: string;
  concept: string;
  issueDate: Date;
  dueDate?: Date;
  /** Lo que queda por pagar, no el total original si ya se pagó algo antes de migrar. */
  amount: number;
}

export function validateSupplierInvoiceRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<SupplierInvoiceImportRow> {
  const errors: string[] = [];
  const data: Partial<SupplierInvoiceImportRow> = {};

  const supplierName = mappedRow['supplierName']?.trim();
  if (!supplierName) errors.push('Falta el nombre del proveedor.');
  else data.supplierName = supplierName;

  const number = mappedRow['number']?.trim();
  if (!number) errors.push('Falta el número de factura.');
  else data.number = number;

  const concept = mappedRow['concept']?.trim();
  if (!concept) errors.push('Falta el concepto.');
  else data.concept = concept;

  const issueDateRaw = mappedRow['issueDate']?.trim();
  const issueDate = issueDateRaw ? parseSpanishDate(issueDateRaw) : null;
  if (!issueDateRaw) errors.push('Falta la fecha de la factura.');
  else if (!issueDate)
    errors.push(`Fecha de factura inválida: "${issueDateRaw}".`);
  else data.issueDate = issueDate;

  const dueDateRaw = mappedRow['dueDate']?.trim();
  if (dueDateRaw) {
    const dueDate = parseSpanishDate(dueDateRaw);
    if (!dueDate)
      errors.push(`Fecha de vencimiento inválida: "${dueDateRaw}".`);
    else data.dueDate = dueDate;
  }

  const amountRaw = mappedRow['amount']?.trim();
  const amount = amountRaw ? parseSpanishDecimal(amountRaw) : null;
  if (!amountRaw) errors.push('Falta el importe pendiente.');
  else if (amount === null || amount <= 0)
    errors.push(`Importe inválido: "${amountRaw}".`);
  else data.amount = amount;

  return {
    rowNumber,
    ok: errors.length === 0,
    data: errors.length === 0 ? (data as SupplierInvoiceImportRow) : undefined,
    errors,
    warnings: [],
  };
}
