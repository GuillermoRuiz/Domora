/**
 * La auditoría (`ai_audit.details`) guarda METADATOS TÉCNICOS: identificadores, códigos, modos, importes de uso,
 * latencias… Nunca contenido del expediente (el texto de una incidencia o de un correo, nombres, resúmenes), que
 * vive en su propia entidad y tiene su propia retención. Este filtro lo garantiza aunque un llamador pase de más:
 * solo se conservan números, booleanos, nulos, identificadores (UUID), fechas ISO y códigos cortos sin espacios
 * (`autonomy_1`, `AI_NOT_ENTITLED`, `gpt-4.1-mini`…); cualquier otro texto se descarta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
const CODE = /^[A-Za-z0-9_.:/@+-]{1,100}$/;

const MAX_DEPTH = 6;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function keep(value: unknown, depth: number): Json | undefined {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return UUID.test(value) || ISO_DATE.test(value) || CODE.test(value)
      ? value
      : undefined;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value))
    return value
      .map((v) => keep(v, depth + 1))
      .filter((v): v is Json => v !== undefined);
  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const kept = keep(v, depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  return undefined;
}

/** Los metadatos técnicos de `details`; `undefined` si no queda nada que guardar. */
export function technicalDetails(details: unknown): Json | undefined {
  if (details === undefined) return undefined;
  return keep(details, 0);
}
