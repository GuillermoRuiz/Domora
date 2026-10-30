import * as crypto from 'node:crypto';

/**
 * Cálculo de la huella de los registros de facturación (RD 1007/2023).
 *
 * Implementado contra el documento normativo de la AEAT «Detalle de las
 * especificaciones técnicas para generación de la huella o hash de los
 * registros de facturación», v0.1.2 (27/08/2024), que desarrolla el art. 13
 * de la Orden HAC/1177/2024. **Los tres ejemplos oficiales del apartado 6 se
 * reproducen en `verifactu-hash.spec.ts`** y son el criterio de conformidad:
 * si alguno deja de coincidir, la implementación se ha desviado de la norma.
 *
 * Formato: `campo1=valor1&campo2=valor2&...` en UTF-8, SHA-256, salida
 * hexadecimal en MAYÚSCULAS de 64 caracteres. De los valores se eliminan solo
 * los espacios inicial y final —los interiores se conservan: el propio
 * documento pone como ejemplo que `" 12345678 / G33 "` da `"12345678 / G33"`—
 * y un campo ausente o vacío aparece igualmente como `campo=`.
 *
 * Todo lo normativo se concentra aquí, en funciones puras, para que cualquier
 * corrección futura de la especificación no obligue a tocar nada más.
 */

/** Campos del registro de ALTA, en el orden exacto que fija la norma. */
export interface AltaHashFields {
  /** NIF del obligado tributario que expide la factura. */
  idEmisorFactura: string;
  /** Serie y número, tal y como figuran en la factura. */
  numSerieFactura: string;
  /** Fecha de expedición, dd-mm-aaaa. */
  fechaExpedicionFactura: string;
  /** Tipo de factura (F1 completa, F2 simplificada, R1..R5 rectificativas). */
  tipoFactura: string;
  /** Cuota total repercutida. */
  cuotaTotal: string;
  /** Importe total de la factura. */
  importeTotal: string;
  /** Huella del registro anterior de la cadena; vacía si es el primero. */
  huella: string;
  /** Fecha, hora y huso de generación del registro (ISO 8601 con offset). */
  fechaHoraHusoGenRegistro: string;
}

/** Campos del registro de ANULACIÓN. */
export interface AnulacionHashFields {
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  fechaExpedicionFacturaAnulada: string;
  huella: string;
  fechaHoraHusoGenRegistro: string;
}

/**
 * Forma canónica de un importe para la huella: **dos decimales, tal cual irán
 * en el XML**.
 *
 * La norma dice que los importes se tratan «indistintamente con una o dos
 * posiciones en los decimales, sin tener relevancia los ceros a la derecha»,
 * de modo que la AEAT acepta `123.1` y `123.10` como equivalentes. Pero
 * también dice que el valor debe ser «la misma información contenida en el
 * campo correspondiente del fichero XML».
 *
 * Por eso NO se recortan los ceros: si el XML declara `100.00`, la huella se
 * calcula sobre `100.00`. Así el hash es idéntico byte a byte al dato
 * remitido y no depende de que la AEAT normalice igual que nosotros.
 */
export function canonicalAmount(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(value.trim());
  return numeric.toFixed(2);
}

/**
 * Compara dos importes según la regla de equivalencia de la norma (`123.1`
 * ≡ `123.10`). No se usa para generar la huella —para eso está
 * `canonicalAmount`— sino para validar una recibida de un tercero.
 */
export function amountsEquivalent(a: string, b: string): boolean {
  return Number(a) === Number(b);
}

/** Fecha de expedición en el formato dd-mm-aaaa que usa la AEAT. */
export function formatSpanishDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

/** Instante de generación en ISO 8601 con huso horario explícito. */
export function formatTimestampWithZone(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Construye la cadena `campo=valor&...` a partir de pares ya ordenados. */
function buildHashInput(pairs: [string, string][]): string {
  return pairs
    .map(([name, value]) => `${name}=${(value ?? '').toString().trim()}`)
    .join('&');
}

/** Cadena exacta que se hashea para un registro de alta. */
export function buildAltaHashInput(fields: AltaHashFields): string {
  return buildHashInput([
    ['IDEmisorFactura', fields.idEmisorFactura],
    ['NumSerieFactura', fields.numSerieFactura],
    ['FechaExpedicionFactura', fields.fechaExpedicionFactura],
    ['TipoFactura', fields.tipoFactura],
    ['CuotaTotal', fields.cuotaTotal],
    ['ImporteTotal', fields.importeTotal],
    ['Huella', fields.huella],
    ['FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro],
  ]);
}

/** Cadena exacta que se hashea para un registro de anulación. */
export function buildAnulacionHashInput(fields: AnulacionHashFields): string {
  return buildHashInput([
    ['IDEmisorFacturaAnulada', fields.idEmisorFacturaAnulada],
    ['NumSerieFacturaAnulada', fields.numSerieFacturaAnulada],
    ['FechaExpedicionFacturaAnulada', fields.fechaExpedicionFacturaAnulada],
    ['Huella', fields.huella],
    ['FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro],
  ]);
}

/** SHA-256 de la cadena, en hexadecimal y mayúsculas. */
export function computeHash(input: string): string {
  return crypto
    .createHash('sha256')
    .update(input, 'utf8')
    .digest('hex')
    .toUpperCase();
}
