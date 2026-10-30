/**
 * Formato español: coma decimal, punto opcional de miles ("1.234,56" o
 * "12,5"). Si no hay coma, se asume que el valor ya viene con punto decimal
 * (exports genéricos/US). No cubre miles sin coma decimal (p.ej. "1.234"
 * ambiguo entre mil doscientos treinta y cuatro y uno coma dos-tres-cuatro)
 * — irrelevante para los campos que usa esta v1 (coeficiente 0-100, importes
 * de cuota moderados), no se sobre-ingenieriza para el caso general.
 */
export function parseSpanishDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Acepta ISO ("2026-08-30") y los formatos españoles habituales
 * ("30/08/2026", "30-08-2026") — `new Date("30/08/2026")` a secas
 * interpretaría eso como mes 30, día 08 y daría `Invalid Date`, así que
 * hace falta reconocer el orden día/mes/año explícitamente antes de
 * delegar en el parser nativo.
 */
export function parseSpanishDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const es = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (es) {
    const [, day, month, year] = es;
    const d = new Date(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Empareja un valor libre (con o sin acentos/mayúsculas) contra un diccionario de alias → valor del enum destino. */
export function matchEnumAlias<T extends string>(
  raw: string,
  aliases: Record<string, T>,
): T | null {
  const normalized = raw.trim().toLowerCase().normalize('NFD').replace(COMBINING_DIACRITICS, '');
  return aliases[normalized] ?? null;
}

export interface ValidatedRow<T> {
  rowNumber: number;
  ok: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
}
