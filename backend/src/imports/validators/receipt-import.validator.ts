import type {
  PayMethod,
  ReceiptStatus,
  TaxIdCountry,
} from '../../prisma/client';
import {
  matchEnumAlias,
  parseSpanishDate,
  parseSpanishDecimal,
  type ValidatedRow,
} from './parsing.util';

export interface ReceiptImportRow {
  /** Número de recibo TAL CUAL en el origen — se preserva (no se regenera) para que un import de remesas posterior pueda vincularlo por periodo+número. */
  no: string;
  periodKey: string;
  propertyRef: string;
  /** Snapshot al momento de emisión — se toma tal cual de esta fila, NUNCA del propietario actual (ver comentario legal en `AccountingReceipt`). */
  ownerName?: string;
  ownerTaxId?: string;
  ownerTaxIdCountry?: TaxIdCountry;
  iban?: string;
  concept: string;
  kind: string;
  amount: number;
  dueDate?: Date;
  status: ReceiptStatus;
  date: Date;
  method: PayMethod;
  returnCode?: string;
  returnReason?: string;
}

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const STATUS_ALIASES: Record<string, ReceiptStatus> = {
  pagada: 'Pagada',
  pagado: 'Pagada',
  cobrada: 'Pagada',
  cobrado: 'Pagada',
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
  devuelta: 'Devuelto',
};

const METHOD_ALIASES: Record<string, PayMethod> = {
  domiciliacion: 'Domiciliacion',
  domiciliado: 'Domiciliacion',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  'pago en oficina': 'PagoEnOficina',
  oficina: 'PagoEnOficina',
  bizum: 'Bizum',
  devolucion: 'Devolucion',
  pendiente: 'Pendiente',
};

const DEFAULT_KIND = 'Cuota';

export function validateReceiptRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<ReceiptImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Partial<ReceiptImportRow> = {};

  const no = mappedRow['no']?.trim();
  if (!no) errors.push('Falta el número de recibo.');
  else data.no = no;

  const periodKey = mappedRow['periodKey']?.trim();
  if (!periodKey) errors.push('Falta el periodo (formato AAAA-MM).');
  else if (!PERIOD_KEY_RE.test(periodKey))
    errors.push(
      `Periodo con formato inválido: "${periodKey}" (se espera AAAA-MM).`,
    );
  else data.periodKey = periodKey;

  const propertyRef = mappedRow['propertyRef']?.trim();
  if (!propertyRef) errors.push('Falta la referencia de la unidad.');
  else data.propertyRef = propertyRef;

  const ownerName = mappedRow['ownerName']?.trim();
  if (ownerName) data.ownerName = ownerName;
  else
    warnings.push(
      'Sin nombre de propietario en el origen — el recibo se importará sin snapshot de titular.',
    );

  const ownerTaxId = mappedRow['ownerTaxId']?.trim();
  if (ownerTaxId) {
    data.ownerTaxId = ownerTaxId;
    data.ownerTaxIdCountry = 'ES';
  }

  const iban = mappedRow['iban']?.trim().replace(/\s/g, '');
  if (iban) data.iban = iban;

  const concept = mappedRow['concept']?.trim();
  if (!concept) errors.push('Falta el concepto.');
  else data.concept = concept;

  data.kind = mappedRow['kind']?.trim() || DEFAULT_KIND;

  const amountRaw = mappedRow['amount']?.trim();
  const amount = amountRaw ? parseSpanishDecimal(amountRaw) : null;
  if (!amountRaw) errors.push('Falta el importe.');
  else if (amount === null) errors.push(`Importe inválido: "${amountRaw}".`);
  else data.amount = amount;

  const dueDateRaw = mappedRow['dueDate']?.trim();
  if (dueDateRaw) {
    const dueDate = parseSpanishDate(dueDateRaw);
    if (!dueDate)
      errors.push(`Fecha de vencimiento inválida: "${dueDateRaw}".`);
    else data.dueDate = dueDate;
  }

  const statusRaw = mappedRow['status']?.trim();
  const status = statusRaw ? matchEnumAlias(statusRaw, STATUS_ALIASES) : null;
  if (!statusRaw) errors.push('Falta el estado del recibo.');
  else if (!status) errors.push(`Estado no reconocido: "${statusRaw}".`);
  else data.status = status;

  const dateRaw = mappedRow['date']?.trim();
  const date = dateRaw ? parseSpanishDate(dateRaw) : null;
  if (!dateRaw) errors.push('Falta la fecha de emisión.');
  else if (!date) errors.push(`Fecha de emisión inválida: "${dateRaw}".`);
  else data.date = date;

  const methodRaw = mappedRow['method']?.trim();
  const method = methodRaw ? matchEnumAlias(methodRaw, METHOD_ALIASES) : null;
  if (!methodRaw) errors.push('Falta la forma de pago.');
  else if (!method) errors.push(`Forma de pago no reconocida: "${methodRaw}".`);
  else data.method = method;

  if (data.method === 'Domiciliacion' && !data.iban) {
    warnings.push(
      'Recibo domiciliado sin IBAN en el origen — se importa igual, sin ese dato.',
    );
  }

  const returnCode = mappedRow['returnCode']?.trim();
  if (returnCode) data.returnCode = returnCode;
  const returnReason = mappedRow['returnReason']?.trim();
  if (returnReason) data.returnReason = returnReason;

  return {
    rowNumber,
    ok: errors.length === 0,
    data: errors.length === 0 ? (data as ReceiptImportRow) : undefined,
    errors,
    warnings,
  };
}
