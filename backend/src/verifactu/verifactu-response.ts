import { XMLParser } from 'fast-xml-parser';
import type { VerifactuSubmissionState } from '../prisma/client';

/**
 * Lectura de la respuesta del servicio de suministro
 * (`RespuestaSuministro.xsd`).
 *
 * Es una función pura sobre el XML crudo: así se puede probar el tratamiento
 * de cada tipo de respuesta —incluidas las que cuesta provocar de verdad,
 * como el rechazo por duplicado— sin red ni certificado.
 *
 * Dos decisiones del parseo que no son cosméticas:
 *
 * - **`parseTagValue: false`**: todo se lee como texto. Por defecto la
 *   librería convertiría a número cualquier valor que lo parezca, y un
 *   número de factura como `2026001` perdería su forma —o peor, uno con
 *   ceros a la izquierda quedaría alterado—. Lo que se compara con nuestros
 *   registros tiene que ser exactamente lo que envió la AEAT.
 * - **`removeNSPrefix: true`**: la respuesta usa varios namespaces y sus
 *   prefijos no están garantizados; navegar por nombre local es más robusto
 *   que asumir que la AEAT seguirá usando los mismos prefijos.
 */

/** Estado global del envío. */
export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto';

/** Estado de un registro concreto dentro del envío. */
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';

/** Resultado para un registro del lote. */
export interface LineaRespuesta {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  /** `Alta` o `Anulacion`, tal y como lo devuelve la AEAT. */
  operacion: string;
  estado: EstadoRegistro;
  codigoError?: string;
  descripcionError?: string;
  /** Presente solo cuando se rechaza por duplicado. */
  duplicado?: {
    idPeticion?: string;
    estado?: string;
    codigoError?: string;
    descripcionError?: string;
  };
}

/** Respuesta completa del servicio. */
export interface RespuestaSuministro {
  /** Código seguro de verificación. Solo si el envío no fue rechazado. */
  csv?: string;
  estadoEnvio: EstadoEnvio;
  /**
   * Segundos que la AEAT exige esperar antes del siguiente envío. No es una
   * sugerencia: ignorarlo lleva a que rechace por exceso de frecuencia.
   */
  tiempoEsperaSegundos: number;
  lineas: LineaRespuesta[];
}

/** Error de transporte o de protocolo, distinto de un rechazo funcional. */
export class VerifactuSoapFault extends Error {
  constructor(
    message: string,
    readonly faultCode?: string,
  ) {
    super(message);
    this.name = 'VerifactuSoapFault';
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** La librería devuelve objeto si hay un elemento y array si hay varios. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Valor textual de un nodo, o `undefined` si no lo tiene.
 *
 * Se descartan los valores no escalares a propósito: si un nodo trae hijos,
 * la librería devuelve un objeto, y convertirlo daría `"[object Object]"` —un
 * dato basura que se guardaría tan campante junto al registro. Ante una
 * respuesta con una forma inesperada es preferible no tener el dato que
 * tenerlo mal.
 */
function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s === '' ? undefined : s;
}

type Nodo = Record<string, unknown>;

/**
 * Traduce el estado de un registro al estado que guardamos.
 *
 * `AceptadoConErrores` merece atención: el registro **queda registrado** en la
 * AEAT, así que no se puede reenviar tal cual —sería un duplicado—, pero
 * arrastra un defecto que hay que corregir con un registro de subsanación.
 * Tratarlo como un fallo y reintentar sería justo lo contrario de lo debido.
 */
export function estadoRegistroAEstado(
  estado: EstadoRegistro,
): VerifactuSubmissionState {
  switch (estado) {
    case 'Correcto':
      return 'aceptado';
    case 'AceptadoConErrores':
      return 'aceptado_con_errores';
    case 'Incorrecto':
      return 'rechazado';
  }
}

/**
 * Interpreta el XML de respuesta.
 *
 * @throws {VerifactuSoapFault} si el servicio devolvió un Fault o un cuerpo
 * que no se corresponde con el esquema de respuesta — casos en los que no hay
 * ningún estado que registrar y reintentar sí es lo correcto.
 */
export function parseRespuesta(xml: string): RespuestaSuministro {
  const raiz = parser.parse(xml) as Nodo;
  const envelope = raiz['Envelope'] as Nodo | undefined;
  const body = envelope?.['Body'] as Nodo | undefined;

  if (!body) {
    throw new VerifactuSoapFault(
      'La respuesta no contiene un cuerpo SOAP reconocible.',
    );
  }

  const fault = body['Fault'] as Nodo | undefined;
  if (fault) {
    const code = text(fault['faultcode']) ?? text(fault['Code']);
    const reason =
      text(fault['faultstring']) ??
      text(fault['Reason']) ??
      'El servicio devolvió un SOAP Fault sin descripción.';
    throw new VerifactuSoapFault(reason, code);
  }

  const respuesta = body['RespuestaRegFactuSistemaFacturacion'] as
    Nodo | undefined;
  if (!respuesta) {
    throw new VerifactuSoapFault(
      'La respuesta no contiene RespuestaRegFactuSistemaFacturacion.',
    );
  }

  const estadoEnvio = text(respuesta['EstadoEnvio']) as EstadoEnvio | undefined;
  if (!estadoEnvio) {
    throw new VerifactuSoapFault('La respuesta no indica EstadoEnvio.');
  }

  const lineas = asArray(respuesta['RespuestaLinea'] as Nodo | Nodo[]).map(
    (linea): LineaRespuesta => {
      const idFactura = (linea['IDFactura'] ?? {}) as Nodo;
      const duplicado = linea['RegistroDuplicado'] as Nodo | undefined;
      return {
        // La anulación usa los campos "...Anulada": se acepta cualquiera de
        // los dos para poder casar la línea con nuestro registro.
        idEmisorFactura:
          text(idFactura['IDEmisorFactura']) ??
          text(idFactura['IDEmisorFacturaAnulada']) ??
          '',
        numSerieFactura:
          text(idFactura['NumSerieFactura']) ??
          text(idFactura['NumSerieFacturaAnulada']) ??
          '',
        fechaExpedicionFactura:
          text(idFactura['FechaExpedicionFactura']) ??
          text(idFactura['FechaExpedicionFacturaAnulada']) ??
          '',
        operacion: text(linea['Operacion']) ?? '',
        estado: (text(linea['EstadoRegistro']) ??
          'Incorrecto') as EstadoRegistro,
        codigoError: text(linea['CodigoErrorRegistro']),
        descripcionError: text(linea['DescripcionErrorRegistro']),
        duplicado: duplicado
          ? {
              idPeticion: text(duplicado['IdPeticionRegistroDuplicado']),
              estado: text(duplicado['EstadoRegistroDuplicado']),
              codigoError: text(duplicado['CodigoErrorRegistro']),
              descripcionError: text(duplicado['DescripcionErrorRegistro']),
            }
          : undefined,
      };
    },
  );

  return {
    csv: text(respuesta['CSV']),
    estadoEnvio,
    tiempoEsperaSegundos: Number(text(respuesta['TiempoEsperaEnvio']) ?? '0'),
    lineas,
  };
}
