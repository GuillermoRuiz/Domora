/**
 * Referencias catastrales. Un solo sitio para normalizarlas y validarlas: el
 * modal de importación, "Editar finca" y "Nueva finca" las piden, y el
 * backend aplica los mismos patrones (los DTOs de `catastro/` y de finca).
 */

/** Quita espacios y pasa a mayúsculas — como se envían al backend. */
export function normalizeReference(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Referencia de la PARCELA: 14 caracteres alfanuméricos. Es la que guarda la finca. */
export function isParcelReference(normalized: string): boolean {
  return /^[0-9A-Z]{14}$/.test(normalized);
}

/** Cualquier referencia que acepta el Catastro: 14 (parcela), 18 o 20 (una unidad). */
export function isCatastroReference(normalized: string): boolean {
  return /^[0-9A-Z]{14}([0-9A-Z]{4}([0-9A-Z]{2})?)?$/.test(normalized);
}
