import type { AccountRole } from '../../prisma/client';
import {
  matchEnumAlias,
  parseSpanishDate,
  parseSpanishDecimal,
  type ValidatedRow,
} from './parsing.util';

/** Fila del borrador de saldos iniciales (fase 9) según su columna `tipo`. */
export type OpeningBalanceRowType = 'banco' | 'deuda' | 'anticipo' | 'otro';

export interface OpeningBalanceImportRow {
  tipo: OpeningBalanceRowType;
  /** Alias del banco (banco) o referencia de la propiedad (deuda/anticipo). Sin uso en 'otro'. */
  ref?: string;
  /** Obligatorio salvo en 'banco': `OpeningBankBalanceDto` no tiene concepto, el asiento usa uno fijo. */
  concept?: string;
  amount: number;
  /** Solo 'deuda': año del art. 9.1.e LPH al que corresponde. */
  originYear?: number;
  /** Solo 'deuda', opcional. */
  dueDate?: Date;
  /** Solo 'otro'. */
  role?: AccountRole;
  /** Solo 'otro'. */
  side?: 'debit' | 'credit';
}

const TIPO_ALIASES: Record<string, OpeningBalanceRowType> = {
  banco: 'banco',
  bancario: 'banco',
  cuenta: 'banco',
  deuda: 'deuda',
  'saldo anterior': 'deuda',
  anticipo: 'anticipo',
  otro: 'otro',
  otros: 'otro',
};

const SIDE_ALIASES: Record<string, 'debit' | 'credit'> = {
  debe: 'debit',
  debito: 'debit',
  deudor: 'debit',
  haber: 'credit',
  credito: 'credit',
  acreedor: 'credit',
};

/** Alias en español (nombre y código de cuenta) de las 7 cuentas admitidas para 'otro' (`OTHER_BALANCE_ROLES`). */
const ROLE_ALIASES: Record<string, AccountRole> = {
  'fondo de reserva': 'reserve_fund',
  reserva: 'reserve_fund',
  '117': 'reserve_fund',
  remanente: 'retained',
  '120': 'retained',
  'perdidas de ejercicios anteriores': 'prior_losses',
  'perdidas anteriores': 'prior_losses',
  '121': 'prior_losses',
  retenciones: 'withholding_payable',
  irpf: 'withholding_payable',
  '4751': 'withholding_payable',
  'seguridad social': 'social_security_payable',
  '476': 'social_security_payable',
  'salarios pendientes': 'salaries_payable',
  'nominas pendientes': 'salaries_payable',
  '465': 'salaries_payable',
  'pendiente de aplicar': 'suspense',
  '555': 'suspense',
};

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function matchRole(raw: string): AccountRole | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '');
  return ROLE_ALIASES[normalized] ?? null;
}

export function validateOpeningBalanceRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<OpeningBalanceImportRow> {
  const errors: string[] = [];
  const data: Partial<OpeningBalanceImportRow> = {};

  const tipoRaw = mappedRow['tipo']?.trim();
  const tipo = tipoRaw ? matchEnumAlias(tipoRaw, TIPO_ALIASES) : null;
  if (!tipoRaw)
    errors.push('Falta el tipo de saldo (banco/deuda/anticipo/otro).');
  else if (!tipo) errors.push(`Tipo de saldo no reconocido: "${tipoRaw}".`);
  else data.tipo = tipo;

  const concept = mappedRow['concept']?.trim();
  if (concept) data.concept = concept;
  else if (tipo !== 'banco') errors.push('Falta el concepto.');

  const amountRaw = mappedRow['amount']?.trim();
  const amount = amountRaw ? parseSpanishDecimal(amountRaw) : null;
  if (!amountRaw) errors.push('Falta el importe.');
  else if (amount === null || amount <= 0)
    errors.push(`Importe inválido: "${amountRaw}".`);
  else data.amount = amount;

  const ref = mappedRow['ref']?.trim();

  if (tipo === 'banco') {
    if (!ref) errors.push('Falta el alias de la cuenta bancaria.');
    else data.ref = ref;
  } else if (tipo === 'deuda' || tipo === 'anticipo') {
    if (!ref) errors.push('Falta la referencia de la propiedad.');
    else data.ref = ref;
    if (tipo === 'deuda') {
      const originYearRaw = mappedRow['originYear']?.trim();
      const originYear = originYearRaw ? Number(originYearRaw) : null;
      if (!originYearRaw) errors.push('Falta el año de origen de la deuda.');
      else if (
        !Number.isInteger(originYear) ||
        originYear! < 2000 ||
        originYear! > 2100
      )
        errors.push(`Año de origen inválido: "${originYearRaw}".`);
      else data.originYear = originYear!;

      const dueDateRaw = mappedRow['dueDate']?.trim();
      if (dueDateRaw) {
        const dueDate = parseSpanishDate(dueDateRaw);
        if (!dueDate)
          errors.push(`Fecha de vencimiento inválida: "${dueDateRaw}".`);
        else data.dueDate = dueDate;
      }
    }
  } else if (tipo === 'otro') {
    const roleRaw = mappedRow['role']?.trim();
    const role = roleRaw ? matchRole(roleRaw) : null;
    if (!roleRaw) errors.push('Falta la cuenta destino del saldo.');
    else if (!role) errors.push(`Cuenta destino no reconocida: "${roleRaw}".`);
    else data.role = role;

    const sideRaw = mappedRow['side']?.trim();
    const side = sideRaw ? matchEnumAlias(sideRaw, SIDE_ALIASES) : null;
    if (!sideRaw) errors.push('Falta si el saldo es deudor o acreedor.');
    else if (!side) errors.push(`Lado no reconocido: "${sideRaw}".`);
    else data.side = side;
  }

  return {
    rowNumber,
    ok: errors.length === 0,
    data: errors.length === 0 ? (data as OpeningBalanceImportRow) : undefined,
    errors,
    warnings: [],
  };
}
