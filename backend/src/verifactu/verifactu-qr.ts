/**
 * Código QR de cotejo (art. 7 RD 1007/2023, cap. VIII Orden HAC/1177/2024).
 *
 * Igual que la huella, esto es formato normativo: se aísla en funciones puras
 * para que una corrección contra la especificación oficial no obligue a tocar
 * la generación del PDF ni nada más.
 *
 * El QR codifica una URL al servicio de cotejo de la AEAT con cuatro
 * parámetros. Quien recibe la factura puede escanearlo y comprobar en la sede
 * que el emisor la declaró: es lo que convierte la factura en "verificable".
 */

/**
 * Servicio de cotejo de la AEAT.
 *
 * ⚠️ Se ha visto publicada tanto bajo `agenciatributaria.gob.es` como bajo
 * `agenciatributaria.es`. Se deja configurable por si hay que corregirla o
 * apuntar al entorno de pruebas durante la validación previa.
 */
export const AEAT_QR_BASE_URL =
  process.env['VERIFACTU_QR_BASE_URL'] ??
  'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';

/** Nivel de corrección de errores exigido: M (~15% de recuperación). */
export const QR_ERROR_CORRECTION = 'M' as const;

/**
 * Lado del QR en milímetros. La norma admite de 30 a 40 mm; se usa el mínimo
 * para no comerse la factura, que ya cumple de sobra la legibilidad.
 */
export const QR_SIZE_MM = 30;

/** Zona de silencio mínima alrededor del código. */
export const QR_QUIET_ZONE_MM = 2;

/**
 * Leyenda obligatoria en las facturas expedidas por un sistema VERI\*FACTU.
 * La norma admite esta forma corta o "Factura verificable en la sede
 * electrónica de la AEAT"; se usan ambas por claridad para quien la recibe.
 */
export const VERIFACTU_LEGEND = 'VERI*FACTU';
export const VERIFACTU_LEGEND_LONG =
  'Factura verificable en la sede electrónica de la AEAT';

export interface QrInvoiceData {
  /** NIF del emisor. */
  issuerTaxId: string;
  /** Serie y número, tal cual figuran en la factura. */
  invoiceNo: string;
  /** Fecha de expedición. */
  issueDate: Date;
  /** Importe total, con dos decimales. */
  total: string;
}

/** Fecha en el formato dd-mm-aaaa que espera el servicio de cotejo. */
function formatQrDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

/**
 * URL de cotejo que se codifica en el QR.
 *
 * Los valores van codificados para URL porque el número de factura admite
 * caracteres como `/` (por ejemplo `F-5730/2026`), que sin escapar romperían
 * la query string.
 */
export function buildQrUrl(invoice: QrInvoiceData): string {
  const params = new URLSearchParams({
    nif: invoice.issuerTaxId,
    numserie: invoice.invoiceNo,
    fecha: formatQrDate(invoice.issueDate),
    importe: invoice.total,
  });
  return `${AEAT_QR_BASE_URL}?${params.toString()}`;
}
