import { randomBytes } from 'node:crypto';

/** Version of the mandate wording stored with every accepted mandate. */
export const SEPA_MANDATE_TEXT_VERSION = 'sepa-core-es-v1';

/** Environment variable holding Domora's SEPA creditor identifier (AT-02). */
export const SEPA_CREDITOR_ID_ENV = 'DOMORA_SEPA_CREDITOR_ID';

/** Upper case without spaces: ` es11 zzz b12345674 ` → `ES11ZZZB12345674`. */
export function normalizeSepaCreditorId(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Letters become 10..35, digits stay (ISO 7064 MOD 97-10, same as the IBAN). */
function toDigits(value: string): string {
  return [...value].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
}

function mod97(digits: string): number {
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest;
}

/**
 * SEPA creditor identifier: country (2) + check digits (2) + creditor business
 * code (3, excluded from the check) + national identifier. The check digits
 * are computed over national id + country + "00".
 */
export function isValidSepaCreditorId(value: string): boolean {
  const id = normalizeSepaCreditorId(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) return false;
  const country = id.slice(0, 2);
  const check = Number(id.slice(2, 4));
  const national = id.slice(7);
  return 98 - mod97(toDigits(`${national}${country}00`)) === check;
}

function despachoCode(administratorId: string): string {
  return administratorId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Unique mandate reference (UMR, at most 35 characters):
 * `DOM-<first 8 hex of the despacho>-<YYYYMMDD>-<6 random hex>`. Uniqueness is
 * also enforced by the database.
 */
export function generateMandateReference(administratorId: string, at: Date): string {
  const day = at.toISOString().slice(0, 10).replace(/-/g, '');
  const random = randomBytes(3).toString('hex').toUpperCase();
  return `DOM-${despachoCode(administratorId)}-${day}-${random}`;
}

/** Whether a reference has the expected shape and carries this despacho's code. */
export function isMandateReferenceFor(administratorId: string, reference: string): boolean {
  return new RegExp(`^DOM-${despachoCode(administratorId)}-[0-9]{8}-[0-9A-F]{6}$`).test(reference);
}

export interface SepaMandateTextInput {
  reference: string;
  creditorId: string;
  creditorName: string;
  creditorAddress: string;
}

/**
 * Standard Spanish wording of a SEPA CORE direct debit mandate (EPC rulebook,
 * recurrent payments). The debtor's data (name, IBAN, address) are the form
 * fields stored with the mandate, not part of this paragraph.
 */
export function sepaMandateText(input: SepaMandateTextInput): string {
  return [
    'Orden de domiciliación de adeudo directo SEPA',
    `Referencia de la orden de domiciliación: ${input.reference}`,
    `Identificador del acreedor: ${input.creditorId}`,
    `Nombre del acreedor: ${input.creditorName}`,
    `Dirección: ${input.creditorAddress}`,
    'Mediante la firma de esta orden de domiciliación, el deudor autoriza (A) al acreedor a enviar instrucciones a la entidad del deudor para adeudar su cuenta y (B) a la entidad para efectuar los adeudos en su cuenta siguiendo las instrucciones del acreedor. Como parte de sus derechos, el deudor está legitimado al reembolso por su entidad en los términos y condiciones del contrato suscrito con la misma. La solicitud de reembolso deberá efectuarse dentro de las ocho semanas que siguen a la fecha de adeudo en cuenta. Puede obtener información adicional sobre sus derechos en su entidad financiera.',
    'Tipo de pago: pago recurrente.',
  ].join('\n');
}
