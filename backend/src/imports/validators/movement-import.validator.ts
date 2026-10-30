/** Sentido del movimiento: entra dinero, sale, o se traspasa (sale del banco). */
export type MovementType = 'income' | 'expense' | 'transfer';

import { matchEnumAlias, parseSpanishDate, parseSpanishDecimal, type ValidatedRow } from './parsing.util';

export interface MovementImportRow {
  date: Date;
  concept: string;
  accountCode: string;
  accountName?: string;
  type: MovementType;
  /** Siempre positivo (magnitud): el sentido lo da `type` (ver ImportsService.commitMovements). */
  amount: number;
  reference?: string;
}

const TYPE_ALIASES: Record<string, MovementType> = {
  income: 'income',
  ingreso: 'income',
  ingresos: 'income',
  haber: 'income',
  expense: 'expense',
  gasto: 'expense',
  gastos: 'expense',
  debe: 'expense',
  transfer: 'transfer',
  traspaso: 'transfer',
  transferencia: 'transfer',
};

export function validateMovementRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<MovementImportRow> {
  const errors: string[] = [];
  const data: Partial<MovementImportRow> = {};

  const dateRaw = mappedRow['date']?.trim();
  const date = dateRaw ? parseSpanishDate(dateRaw) : null;
  if (!dateRaw) errors.push('Falta la fecha del movimiento.');
  else if (!date) errors.push(`Fecha inválida: "${dateRaw}".`);
  else data.date = date;

  const concept = mappedRow['concept']?.trim();
  if (!concept) errors.push('Falta el concepto.');
  else data.concept = concept;

  const accountCode = mappedRow['accountCode']?.trim();
  if (!accountCode) errors.push('Falta el código de cuenta contable.');
  else data.accountCode = accountCode;

  const accountName = mappedRow['accountName']?.trim();
  if (accountName) data.accountName = accountName;

  const typeRaw = mappedRow['type']?.trim();
  const type = typeRaw ? matchEnumAlias(typeRaw, TYPE_ALIASES) : null;
  if (!typeRaw) errors.push('Falta el tipo de movimiento (ingreso/gasto/traspaso).');
  else if (!type) errors.push(`Tipo de movimiento no reconocido: "${typeRaw}".`);
  else data.type = type;

  const amountRaw = mappedRow['amount']?.trim();
  const amount = amountRaw ? parseSpanishDecimal(amountRaw) : null;
  if (!amountRaw) errors.push('Falta el importe.');
  else if (amount === null) errors.push(`Importe inválido: "${amountRaw}".`);
  else data.amount = Math.abs(amount);

  const reference = mappedRow['reference']?.trim();
  if (reference) data.reference = reference;

  return {
    rowNumber,
    ok: errors.length === 0,
    data: errors.length === 0 ? (data as MovementImportRow) : undefined,
    errors,
    warnings: [],
  };
}
