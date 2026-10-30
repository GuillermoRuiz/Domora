import { isValidDniOrNie } from '../common/spanish-id';

/** Letters of a CIF (legal entities). */
const CIF_LETTERS = 'ABCDEFGHJNPQRSUVW';
/** Their control is always a letter (public bodies, foreign entities, non-residents, religious orders). */
const LETTER_CONTROL = 'NPQRSW';
/** Their control is always a digit (sociedades anónimas y limitadas, comunidades de bienes, …). */
const DIGIT_CONTROL = 'ABEH';
const CONTROL_LETTERS = 'JABCDEFGHI';

/** Strips spaces, dots and hyphens and upper-cases: `b-1234567.4` → `B12345674`. */
export function normalizeSpanishTaxId(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

function isValidCif(id: string): boolean {
  if (!new RegExp(`^[${CIF_LETTERS}][0-9]{7}[0-9A-J]$`).test(id)) return false;
  const digits = id.slice(1, 8);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(digits[i]);
    if (i % 2 === 1) {
      sum += n;
    } else {
      const doubled = n * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    }
  }
  const control = (10 - (sum % 10)) % 10;
  const given = id[8];
  const letter = id[0];
  const asDigit = given === String(control);
  const asLetter = given === CONTROL_LETTERS[control];
  if (LETTER_CONTROL.includes(letter)) return asLetter;
  if (DIGIT_CONTROL.includes(letter)) return asDigit;
  return asDigit || asLetter;
}

/**
 * Spanish NIF with its check digit: CIF of a legal entity, DNI or NIE. It is
 * the recipient NIF that Domora's invoices send to the AEAT through Verifactu,
 * so a typo would reach the tax agency.
 */
export function isValidSpanishTaxId(value: string): boolean {
  const id = normalizeSpanishTaxId(value);
  if (!id) return false;
  return isValidCif(id) || isValidDniOrNie(id);
}
