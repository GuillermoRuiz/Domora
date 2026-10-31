const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Quita espacios, puntos y guiones y pasa a mayúsculas: `12.345.678-z` → `12345678Z`. */
export function normalizeSpanishId(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

/** DNI (8 cifras + letra) o NIE (X/Y/Z + 7 cifras + letra) con la letra de control correcta. */
export function isValidDniOrNie(value: string): boolean {
  const id = normalizeSpanishId(value);
  if (!/^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$/.test(id)) return false;
  const digits = id
    .replace('X', '0')
    .replace('Y', '1')
    .replace('Z', '2')
    .slice(0, 8);
  return DNI_LETTERS[Number(digits) % 23] === id[8];
}
