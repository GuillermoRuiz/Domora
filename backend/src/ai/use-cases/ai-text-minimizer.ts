/**
 * Reducción determinista de texto libre ANTES de enviarlo al modelo. No sustituye a la lista blanca de campos
 * (que es el control principal): es una segunda barrera para lo que no se puede evitar que escriba una persona.
 */

const REPLY_HEADER = [
  /^\s*(?:on|el)\s.{5,200}?(?:wrote|escribi[óo]|ha escrito)\s*:?\s*$/i,
  /^\s*-{2,}\s*(?:original message|mensaje original|forwarded message|mensaje reenviado)/i,
  /^\s*_{5,}\s*$/,
  /^\s*(?:sent from my|enviado desde mi|obtener outlook)/i,
  /^-- ?$/,
];
const HEADER_BLOCK_FIELDS =
  /^\s*(?:enviado|sent|fecha|date|para|to|asunto|subject|cc)\s*:/i;

/**
 * Se queda con lo NUEVO del mensaje: quita las líneas citadas (`>`), el hilo anterior y la firma. Si no queda
 * nada (todo era cita), devuelve el original: mejor texto de más que perder la respuesta.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeader = REPLY_HEADER.some((r) => r.test(line));
    // «De: … / Enviado: … / Para: … / Asunto: …»: la cabecera de un reenvío o de una cita.
    const isFieldBlock =
      /^\s*(?:de|from)\s*:/i.test(line) &&
      lines.slice(i + 1, i + 5).some((l) => HEADER_BLOCK_FIELDS.test(l));
    if (isHeader || isFieldBlock) {
      cut = i;
      break;
    }
  }
  const kept = lines
    .slice(0, cut)
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .trim();
  return kept || text.trim();
}

const PATTERNS: [RegExp, string][] = [
  [/https?:\/\/\S+|www\.\S+/gi, '[enlace]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){4,7}\b/g, '[iban]'],
  [/\b(?:\d{8}|[XYZ]\d{7})[ -]?[A-Z]\b/gi, '[documento]'],
  [/(?:\+34[\s.-]?)?\b[6789](?:[\s.-]?\d){8}\b/g, '[teléfono]'],
];

/** Sustituye emails, teléfonos, IBAN, DNI/NIE y enlaces: no hacen falta para interpretar una respuesta. */
export function scrubPersonalIdentifiers(text: string): string {
  return PATTERNS.reduce(
    (out, [pattern, label]) => out.replace(pattern, label),
    text,
  );
}

/** Texto de una respuesta lista para el modelo: lo nuevo, sin identificadores, con tope. */
export function minimizeReplyText(text: string, max: number): string {
  return scrubPersonalIdentifiers(stripQuotedReply(text)).slice(0, max);
}
