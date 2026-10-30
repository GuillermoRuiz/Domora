import { createHash } from 'node:crypto';

/**
 * Serialización canónica: claves de los objetos ordenadas, sin `undefined`, sin espacios. Dos
 * documentos con el mismo contenido producen exactamente la misma cadena, con independencia del
 * orden en que se construyeron sus claves o de cómo los devolvió la base de datos.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * SHA-256 (hex) del contenido canónico de un acta. Es una huella de integridad y de
 * versionado: NO es una firma. La firma avanzada se conectará después sobre esta huella.
 */
export function actaContentHash(documentModel: unknown): string {
  return createHash('sha256').update(canonicalJson(documentModel), 'utf8').digest('hex');
}
