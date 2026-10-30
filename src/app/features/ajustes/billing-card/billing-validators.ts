import { isValidDniOrNie } from '../../../core/spanish-id';

/**
 * Client-side copies of the backend checks (`backend/src/admin-billing/`), only
 * to warn before saving: the server stays the authority.
 */
const CIF_LETTERS = 'ABCDEFGHJNPQRSUVW';
const LETTER_CONTROL = 'NPQRSW';
const DIGIT_CONTROL = 'ABEH';
const CONTROL_LETTERS = 'JABCDEFGHI';

const normalize = (value: string): string => value.replace(/[\s.-]/g, '').toUpperCase();

function isValidCif(id: string): boolean {
  if (!new RegExp(`^[${CIF_LETTERS}][0-9]{7}[0-9A-J]$`).test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(id[i + 1]);
    if (i % 2 === 1) sum += n;
    else sum += Math.floor((n * 2) / 10) + ((n * 2) % 10);
  }
  const control = (10 - (sum % 10)) % 10;
  const asDigit = id[8] === String(control);
  const asLetter = id[8] === CONTROL_LETTERS[control];
  if (LETTER_CONTROL.includes(id[0])) return asLetter;
  if (DIGIT_CONTROL.includes(id[0])) return asDigit;
  return asDigit || asLetter;
}

/** CIF, DNI or NIE with its check digit. */
export function isValidSpanishTaxId(value: string): boolean {
  const id = normalize(value);
  return !!id && (isValidCif(id) || isValidDniOrNie(id));
}

/** IBAN with valid ISO 13616 check digits (MOD 97). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}
