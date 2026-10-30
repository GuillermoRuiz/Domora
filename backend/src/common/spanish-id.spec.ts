import { isValidDniOrNie, normalizeSpanishId } from './spanish-id';

describe('spanish-id', () => {
  it('normaliza separadores y mayúsculas', () => {
    expect(normalizeSpanishId(' 12.345.678-z ')).toBe('12345678Z');
  });

  it('valida DNI y NIE por su letra de control', () => {
    expect(isValidDniOrNie('12345678Z')).toBe(true);
    expect(isValidDniOrNie('12.345.678-z')).toBe(true);
    expect(isValidDniOrNie('X1234567L')).toBe(true);
    expect(isValidDniOrNie('12345678A')).toBe(false);
    expect(isValidDniOrNie('1234567Z')).toBe(false);
    expect(isValidDniOrNie('')).toBe(false);
  });
});
