import { type Rng, pick, randDigits } from './rng';

/** Entidades reales (código de 4 dígitos). */
export const SPANISH_BANK_CODES = [
  '2100', // CaixaBank
  '0049', // Santander
  '0182', // BBVA
  '0081', // Sabadell
  '2038', // Bankia / CaixaBank
  '0128', // Bankinter
  '2085', // Ibercaja
  '3058', // Cajamar
] as const;

const WEIGHTS = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];

function controlDigit(tenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(tenDigits.charAt(i)) * (WEIGHTS[i] as number);
  }
  const d = 11 - (sum % 11);
  return d === 11 ? 0 : d === 10 ? 1 : d;
}

/** Dígitos de control nacionales (2) de entidad+oficina+cuenta. */
export function nationalCheckDigits(
  bank: string,
  branch: string,
  account: string,
): string {
  return `${controlDigit(`00${bank}${branch}`)}${controlDigit(account)}`;
}

/** mod 97 iterativo sobre una cadena de dígitos (sin BigInt). */
export function mod97(digits: string): number {
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

/** Dígitos de control IBAN (2) para un BBAN español de 20 dígitos. */
export function ibanCheckDigits(bban: string): string {
  const check = 98 - mod97(`${bban}142800`); // "ES00" -> 142800
  return String(check).padStart(2, '0');
}

export function formatIban(iban: string): string {
  return iban
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

export function makeIban(
  rng: Rng,
  bankCode?: string,
  format: 'compact' | 'spaced' = 'compact',
): string {
  const bank = bankCode ?? pick(rng, SPANISH_BANK_CODES);
  if (!/^\d{4}$/.test(bank)) {
    throw new RangeError(`makeIban: entidad inválida "${bank}"`);
  }
  const branch = randDigits(rng, 4);
  const account = randDigits(rng, 10);
  const bban = `${bank}${branch}${nationalCheckDigits(bank, branch, account)}${account}`;
  const iban = `ES${ibanCheckDigits(bban)}${bban}`;
  return format === 'spaced' ? formatIban(iban) : iban;
}

/** IBAN español válido: formato, control nacional y mod 97. */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^ES\d{22}$/.test(iban)) return false;
  const bban = iban.slice(4);
  const bank = bban.slice(0, 4);
  const branch = bban.slice(4, 8);
  const dc = bban.slice(8, 10);
  const account = bban.slice(10);
  if (nationalCheckDigits(bank, branch, account) !== dc) return false;
  // Se mueve "ES"+control al final; ES = 14 28.
  return mod97(`${bban}1428${iban.slice(2, 4)}`) === 1;
}
