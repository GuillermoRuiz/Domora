import { type Rng, pick, randDigits } from './rng';

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const NIE_PREFIX = { X: '0', Y: '1', Z: '2' } as const;
/** Letras de control del CIF cuando debe ser letra (índice = dígito D). */
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';
/** Organizaciones cuyo control es siempre letra / siempre dígito. */
const CIF_LETTER_ORGS = 'KPQSNW';
const CIF_DIGIT_ORGS = 'ABEH';
/** Letras de organización admitidas por el backend (create-estate.dto.ts). */
export const CIF_ORG_LETTERS = 'ABCDEFGHJNPQRSUVW';

function dniLetter(n: number): string {
  return DNI_LETTERS.charAt(n % 23);
}

export function makeDni(rng: Rng): string {
  const digits = randDigits(rng, 8);
  return `${digits}${dniLetter(Number(digits))}`;
}

export function makeNie(rng: Rng): string {
  const prefix = pick(rng, ['X', 'Y', 'Z'] as const);
  const digits = randDigits(rng, 7);
  return `${prefix}${digits}${dniLetter(Number(NIE_PREFIX[prefix] + digits))}`;
}

export function isValidDni(value: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(value.toUpperCase());
  return !!m && dniLetter(Number(m[1])) === m[2];
}

export function isValidNie(value: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(value.toUpperCase());
  if (!m) return false;
  const prefix = NIE_PREFIX[m[1] as keyof typeof NIE_PREFIX];
  return dniLetter(Number(prefix + m[2])) === m[3];
}

/** Dígito de control numérico D del CIF (algoritmo oficial). */
function cifControlDigit(sevenDigits: string): number {
  let even = 0;
  let odd = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(sevenDigits.charAt(i));
    if (i % 2 === 1) {
      even += d; // posiciones 2ª, 4ª, 6ª
    } else {
      const doubled = d * 2; // posiciones 1ª, 3ª, 5ª, 7ª
      odd += Math.floor(doubled / 10) + (doubled % 10);
    }
  }
  return (10 - ((even + odd) % 10)) % 10;
}

/**
 * CIF de sociedad. `org` por defecto B (S.L.); comunidades de propietarios: H.
 * Control: dígito para A/B/E/H, letra para K/P/Q/S/N/W, dígito para el resto.
 */
export function makeCif(rng: Rng, org: string = 'B'): string {
  if (org.length !== 1 || !CIF_ORG_LETTERS.includes(org)) {
    throw new RangeError(`makeCif: letra de organización no admitida "${org}"`);
  }
  const body = randDigits(rng, 7);
  const d = cifControlDigit(body);
  const control = CIF_LETTER_ORGS.includes(org)
    ? CIF_CONTROL_LETTERS.charAt(d)
    : String(d);
  return `${org}${body}${control}`;
}

export function isValidCif(value: string): boolean {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(
    value.toUpperCase(),
  );
  if (!m) return false;
  const org = m[1] as string;
  const d = cifControlDigit(m[2] as string);
  const control = m[3] as string;
  const asDigit = String(d);
  const asLetter = CIF_CONTROL_LETTERS.charAt(d);
  if (CIF_LETTER_ORGS.includes(org)) return control === asLetter;
  if (CIF_DIGIT_ORGS.includes(org)) return control === asDigit;
  return control === asDigit || control === asLetter;
}

/** Validador independiente: DNI, NIE o CIF. */
export function isValidSpanishTaxId(value: string): boolean {
  return isValidDni(value) || isValidNie(value) || isValidCif(value);
}
