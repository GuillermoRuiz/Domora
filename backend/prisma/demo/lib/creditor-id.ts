/**
 * Identificador de acreedor SEPA español (creditorId, 16 caracteres):
 *   ES + 2 dígitos de control + 3 caracteres de sufijo ("000" por defecto) + NIF (9).
 * El control es el mod-97 de `NIF + "ES" + control` (letras A=10..Z=35) igual a
 * 1; replica `SepaPain008Service.isValidSpanishCreditorId` del backend (que el
 * test del seed también invoca como validador independiente).
 */
function letterDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    out += /^\d$/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  }
  return out;
}

function mod97(digits: string): number {
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

export function makeCreditorId(nif: string, suffix = '000'): string {
  const normalized = nif.trim().toUpperCase();
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(normalized)) {
    throw new RangeError(`makeCreditorId: NIF inválido "${nif}"`);
  }
  if (!/^[A-Z0-9]{3}$/.test(suffix)) {
    throw new RangeError(`makeCreditorId: sufijo inválido "${suffix}"`);
  }
  const base = mod97(`${letterDigits(normalized)}${letterDigits('ES')}00`);
  const check = String(98 - base).padStart(2, '0');
  return `ES${check}${suffix}${normalized}`;
}

export function isValidCreditorId(cid: string): boolean {
  if (cid.length !== 16 || !cid.startsWith('ES')) return false;
  const check = cid.slice(2, 4);
  if (!/^\d{2}$/.test(check)) return false;
  const nif = cid.slice(7);
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(nif)) return false;
  return mod97(`${letterDigits(nif)}${letterDigits('ES')}${check}`) === 1;
}
