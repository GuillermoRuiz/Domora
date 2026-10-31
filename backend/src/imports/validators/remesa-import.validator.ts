import type {
  MandateSeq,
  RemesaLineStatus,
  SepaScheme,
} from '../../prisma/client';
import {
  matchEnumAlias,
  parseSpanishDate,
  parseSpanishDecimal,
  type ValidatedRow,
} from './parsing.util';

/**
 * Cada fila es una LÍNEA de remesa que se vincula a un recibo ya importado
 * (por `periodKey`+`receiptNo`) — el agrupado en cabeceras `RemesaHistoryItem`
 * por `remesaRef` lo hace `commitRemesas` en `imports.service.ts`, no este
 * validador (que solo valida la forma de una fila suelta).
 */
export interface RemesaLineImportRow {
  remesaRef: string;
  periodKey: string;
  receiptNo: string;
  amount: number;
  status: RemesaLineStatus;
  mandateSeq: MandateSeq;
  scheme: SepaScheme;
  remesaConcept?: string;
  presentedAt?: Date;
  chargeDate?: Date;
  returnCode?: string;
  returnReason?: string;
}

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const STATUS_ALIASES: Record<string, RemesaLineStatus> = {
  cobrado: 'Cobrado',
  cobrada: 'Cobrado',
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
  devuelta: 'Devuelto',
};

const SEQ_ALIASES: Record<string, MandateSeq> = {
  frst: 'FRST',
  rcur: 'RCUR',
  ooff: 'OOFF',
  fnal: 'FNAL',
};

const SCHEME_ALIASES: Record<string, SepaScheme> = {
  core: 'CORE',
  b2b: 'B2B',
};

const DEFAULT_SEQ: MandateSeq = 'RCUR';
const DEFAULT_SCHEME: SepaScheme = 'CORE';

export function validateRemesaRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<RemesaLineImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Partial<RemesaLineImportRow> = {};

  const remesaRef = mappedRow['remesaRef']?.trim();
  if (!remesaRef)
    errors.push('Falta la referencia de la remesa (agrupa las líneas).');
  else data.remesaRef = remesaRef;

  const periodKey = mappedRow['periodKey']?.trim();
  if (!periodKey) errors.push('Falta el periodo del recibo (formato AAAA-MM).');
  else if (!PERIOD_KEY_RE.test(periodKey))
    errors.push(`Periodo con formato inválido: "${periodKey}".`);
  else data.periodKey = periodKey;

  const receiptNo = mappedRow['receiptNo']?.trim();
  if (!receiptNo) errors.push('Falta el número de recibo a vincular.');
  else data.receiptNo = receiptNo;

  const amountRaw = mappedRow['amount']?.trim();
  const amount = amountRaw ? parseSpanishDecimal(amountRaw) : null;
  if (!amountRaw) errors.push('Falta el importe de la línea.');
  else if (amount === null) errors.push(`Importe inválido: "${amountRaw}".`);
  else data.amount = amount;

  const statusRaw = mappedRow['status']?.trim();
  const status = statusRaw ? matchEnumAlias(statusRaw, STATUS_ALIASES) : null;
  if (!statusRaw) errors.push('Falta el estado de la línea.');
  else if (!status) errors.push(`Estado no reconocido: "${statusRaw}".`);
  else data.status = status;

  const seqRaw = mappedRow['mandateSeq']?.trim();
  if (seqRaw) {
    const seq = matchEnumAlias(seqRaw, SEQ_ALIASES);
    if (!seq) errors.push(`Secuencia SEPA no reconocida: "${seqRaw}".`);
    else data.mandateSeq = seq;
  } else {
    data.mandateSeq = DEFAULT_SEQ;
    warnings.push(
      `Sin secuencia SEPA en el origen — se asume "${DEFAULT_SEQ}".`,
    );
  }

  const schemeRaw = mappedRow['scheme']?.trim();
  if (schemeRaw) {
    const scheme = matchEnumAlias(schemeRaw, SCHEME_ALIASES);
    if (!scheme) errors.push(`Esquema SEPA no reconocido: "${schemeRaw}".`);
    else data.scheme = scheme;
  } else {
    data.scheme = DEFAULT_SCHEME;
  }

  const remesaConcept = mappedRow['remesaConcept']?.trim();
  if (remesaConcept) data.remesaConcept = remesaConcept;

  const presentedAtRaw = mappedRow['presentedAt']?.trim();
  if (presentedAtRaw) {
    const presentedAt = parseSpanishDate(presentedAtRaw);
    if (!presentedAt)
      errors.push(`Fecha de presentación inválida: "${presentedAtRaw}".`);
    else data.presentedAt = presentedAt;
  }

  const chargeDateRaw = mappedRow['chargeDate']?.trim();
  if (chargeDateRaw) {
    const chargeDate = parseSpanishDate(chargeDateRaw);
    if (!chargeDate)
      errors.push(`Fecha de cargo inválida: "${chargeDateRaw}".`);
    else data.chargeDate = chargeDate;
  }

  const returnCode = mappedRow['returnCode']?.trim();
  if (returnCode) data.returnCode = returnCode;
  const returnReason = mappedRow['returnReason']?.trim();
  if (returnReason) data.returnReason = returnReason;

  return {
    rowNumber,
    ok: errors.length === 0,
    data: errors.length === 0 ? (data as RemesaLineImportRow) : undefined,
    errors,
    warnings,
  };
}
