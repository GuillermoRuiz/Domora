/**
 * Resolución del endpoint del servicio web de la AEAT.
 *
 * Las URL salen de los `soap:address` del WSDL oficial
 * (`tools/verifactu-xsd/SistemaFacturacion.wsdl`), no de documentación de
 * terceros: **las entradas están segregadas por tipo de certificado** y las
 * fuentes de segunda mano solo documentan la de sello.
 *
 * Esto importa más de lo que parece: usar la URL del tipo de certificado
 * equivocado falla en el **handshake TLS**, no en el XML. El síntoma —una
 * conexión rechazada— no apunta en absoluto a la causa, así que es un error
 * caro de diagnosticar. Por eso la elección es explícita y está tipada, en
 * lugar de ser una URL suelta en configuración.
 */

/** Entorno de la AEAT. Preproducción no emite registros con validez fiscal. */
export type VerifactuEnv = 'preproduccion' | 'produccion';

/**
 * Tipo de certificado.
 *
 * - `normal`: persona física o representante de persona jurídica.
 * - `sello`: certificado de sello electrónico de entidad, pensado para
 *   sistemas desatendidos porque no se revoca al cambiar el representante.
 */
export type VerifactuCertType = 'normal' | 'sello';

const HOSTS: Record<VerifactuEnv, Record<VerifactuCertType, string>> = {
  produccion: {
    normal: 'https://www1.agenciatributaria.gob.es',
    sello: 'https://www10.agenciatributaria.gob.es',
  },
  preproduccion: {
    normal: 'https://prewww1.aeat.es',
    sello: 'https://prewww10.aeat.es',
  },
};

/** Ruta común a los cuatro puertos del servicio de suministro. */
export const VERIFACTU_PATH =
  '/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';

/** URL completa del servicio para un entorno y tipo de certificado. */
export function verifactuEndpoint(
  env: VerifactuEnv,
  certType: VerifactuCertType,
): string {
  return `${HOSTS[env][certType]}${VERIFACTU_PATH}`;
}
