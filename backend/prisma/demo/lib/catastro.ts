import { type Rng, randDigits } from './rng';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randLetters(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += LETTERS.charAt(Math.floor(rng() * LETTERS.length));
  }
  return s;
}

/**
 * Referencia catastral SINTÉTICA de la PARCELA (14 caracteres): 7 dígitos +
 * 2 letras + 4 dígitos + 1 letra, el mismo formato que las reales. El backend
 * solo valida `/^[0-9A-Z]{14}$/` (no el dígito de control oficial), y estas
 * referencias NO corresponden a ninguna finca real.
 */
export function makeParcelReference(rng: Rng): string {
  return `${randDigits(rng, 7)}${randLetters(rng, 2)}${randDigits(rng, 4)}${randLetters(rng, 1)}`;
}

/**
 * Referencia catastral de una UNIDAD (20 caracteres): parcela (14) + número
 * de cargo (4 dígitos) + 2 letras de control (sintéticas, no oficiales).
 */
export function makeUnitReference(
  rng: Rng,
  parcel: string,
  unitNumber: number,
): string {
  return `${parcel}${String(unitNumber).padStart(4, '0')}${randLetters(rng, 2)}`;
}

export function isValidParcelReference(value: string): boolean {
  return /^[0-9A-Z]{14}$/.test(value);
}

export function isValidUnitReference(value: string): boolean {
  return /^\d{7}[A-Z]{2}\d{4}[A-Z]\d{4}[A-Z]{2}$/.test(value);
}
