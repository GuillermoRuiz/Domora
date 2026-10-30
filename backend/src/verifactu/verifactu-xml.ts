/**
 * Serialización XML de los registros de facturación para el servicio web de
 * la AEAT (`RegFactuSistemaFacturacion`).
 *
 * Escrito contra los esquemas oficiales descargados de
 * `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/`
 * — `SistemaFacturacion.wsdl`, `SuministroLR.xsd` y `SuministroInformacion.xsd`.
 *
 * Dos detalles del esquema que no se deducen y que, mal resueltos, provocan
 * rechazo del envío entero:
 *
 * 1. **Ambos esquemas declaran `elementFormDefault="qualified"`**, así que
 *    TODOS los elementos van cualificados por namespace, no solo los raíz.
 * 2. **`Cabecera` y `RegistroFactura` pertenecen al namespace de
 *    `SuministroLR`** (se declaran ahí como elementos locales), mientras que
 *    sus hijos pertenecen al de `SuministroInformacion`, porque sus tipos se
 *    definen en ese otro esquema. Mezclarlos es el error clásico.
 *
 * El módulo es de funciones puras: no conoce Prisma, ni la red, ni la
 * configuración. Así el XML se puede probar entero sin certificado ni
 * conexión, que es justo lo que permite avanzar antes de tener acceso a
 * preproducción.
 */

const BASE_NS =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws';

export const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  /** Envoltorio del suministro: `RegFactuSistemaFacturacion`, `Cabecera`, `RegistroFactura`. */
  sfLR: `${BASE_NS}/SuministroLR.xsd`,
  /** Tipos comunes: `RegistroAlta`, `RegistroAnulacion` y todos sus hijos. */
  sf: `${BASE_NS}/SuministroInformacion.xsd`,
  /** Namespace de la respuesta, necesario para localizar nodos al parsear. */
  sfR: `${BASE_NS}/RespuestaSuministro.xsd`,
} as const;

/** Única versión admitida hoy por `VersionType`. */
export const ID_VERSION = '1.0';
/** `TipoHuellaType`: 01 = SHA-256. Es el único valor del enumerado. */
export const TIPO_HUELLA_SHA256 = '01';
/** `ImpuestoType`: 01 = IVA. */
export const IMPUESTO_IVA = '01';
/** `IdOperacionesTrascendenciaTributariaType`: 01 = régimen general. */
export const CLAVE_REGIMEN_GENERAL = '01';
/** `CalificacionOperacionType`: S1 = sujeta y no exenta, sin inversión del sujeto pasivo. */
export const CALIFICACION_SUJETA_NO_EXENTA = 'S1';
/** `ClaveTipoFacturaType`: F1 = factura completa del art. 6 RD 1619/2012. */
export const TIPO_FACTURA_COMPLETA = 'F1';

/** Persona física o jurídica española: razón social + NIF de 9 caracteres. */
export interface Party {
  nombreRazon: string;
  nif: string;
}

/**
 * Cabecera del envío.
 *
 * `representante` se rellena **solo** cuando quien genera y remite los
 * registros no es el propio obligado tributario, sino un asesor o apoderado.
 * Es el mecanismo previsto por la AEAT para que un tercero suministre en
 * nombre de otro **con su propio certificado**, sin custodiar el ajeno.
 */
export interface Cabecera {
  obligado: Party;
  representante?: Party;
}

/**
 * Identificación del sistema informático de facturación. Va en CADA registro
 * y es la huella del productor del software: son los mismos datos que
 * respalda la declaración responsable.
 */
export interface SistemaInformatico {
  /** Productor del software (Domora), no el obligado tributario. */
  productor: Party;
  /** Nombre comercial del sistema. Máximo 30 caracteres. */
  nombreSistemaInformatico: string;
  /** Identificador del sistema dentro del productor. Máximo 2 caracteres. */
  idSistemaInformatico: string;
  version: string;
  numeroInstalacion: string;
  /** ¿El sistema solo puede funcionar en modo VERI\*FACTU? */
  soloVerifactu: boolean;
  /** ¿Puede usarse por varios obligados tributarios? */
  multiObligado: boolean;
  /** ¿Se está usando de hecho para varios obligados? */
  usandoMultiObligado: boolean;
}

/** Referencia al registro anterior de la cadena. */
export interface RegistroAnterior {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  huella: string;
}

/** `PrimerRegistro = 'S'` o los datos del anterior: el esquema es un `choice`. */
export type Encadenamiento = 'primero' | RegistroAnterior;

/** Una línea del desglose por tipo impositivo (máximo 12 por registro). */
export interface DesgloseLinea {
  impuesto: string;
  claveRegimen: string;
  calificacionOperacion: string;
  /** Porcentaje, con el formato de `Tipo2.2Type` (p. ej. "21.00"). */
  tipoImpositivo: string;
  baseImponible: string;
  cuotaRepercutida: string;
}

/** Registro de alta, con los campos en el orden que impone el `xs:sequence`. */
export interface RegistroAlta {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  nombreRazonEmisor: string;
  /**
   * El registro corrige un Alta que la AEAT ya había ACEPTADO —con
   * errores— y que por tanto sigue existiendo en su sistema.
   */
  subsanacion?: boolean;
  /**
   * El registro reemplaza un Alta que la AEAT RECHAZÓ de plano: nunca llegó
   * a registrarse, así que no hay nada que "corregir" en su sistema — es un
   * alta nueva de la misma factura que declara el intento fallido anterior.
   * A diferencia de `subsanacion`, mutuamente excluyente con ella: el propio
   * esquema documenta que un alta no admite `RechazoPrevio` en {N, X}, solo
   * la ausencia del campo (nunca hubo rechazo) o `S` (lo hubo).
   *
   * Verificado contra preproducción: reenviar sin este campo un Alta que ya
   * fue rechazada no tiene forma de decir "esto ya lo intenté antes".
   */
  rechazoPrevio?: boolean;
  tipoFactura: string;
  /** Fecha de la operación, si difiere de la de expedición. */
  fechaOperacion?: string;
  descripcionOperacion: string;
  destinatarios?: Party[];
  desglose: DesgloseLinea[];
  cuotaTotal: string;
  importeTotal: string;
  encadenamiento: Encadenamiento;
  fechaHoraHusoGenRegistro: string;
  huella: string;
}

/** Registro de anulación. */
export interface RegistroAnulacion {
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  fechaExpedicionFacturaAnulada: string;
  /**
   * Se anula una factura cuyo Alta nunca llegó a registrarse en la AEAT
   * (fue rechazada). Verificado contra preproducción: una anulación normal
   * de un Alta rechazada vuelve con "No existe el registro de facturación"
   * (código 3002) — sin este campo la AEAT no tiene nada que anular desde
   * su lado.
   */
  sinRegistroPrevio?: boolean;
  encadenamiento: Encadenamiento;
  fechaHoraHusoGenRegistro: string;
  huella: string;
}

export type RegistroFactura =
  | { tipo: 'alta'; datos: RegistroAlta }
  | { tipo: 'anulacion'; datos: RegistroAnulacion };

/**
 * Escapa el texto para XML.
 *
 * Se escapan también `"` y `'` aunque en contenido de elemento no haga falta:
 * cuesta lo mismo y evita que una razón social con comillas se convierta en
 * un problema el día que este texto se reutilice en un atributo.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Elemento simple con texto ya escapado. */
function el(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

/** Elemento opcional: se omite por completo si no hay valor. */
function optional(name: string, value: string | undefined): string {
  return value === undefined || value === '' ? '' : el(name, value);
}

/** `SiNoType`: el esquema espera literalmente 'S' o 'N'. */
function siNo(value: boolean): string {
  return value ? 'S' : 'N';
}

function partyXml(tag: string, party: Party): string {
  return `<${tag}>${el('sf:NombreRazon', party.nombreRazon)}${el('sf:NIF', party.nif)}</${tag}>`;
}

function encadenamientoXml(encadenamiento: Encadenamiento): string {
  if (encadenamiento === 'primero') {
    return `<sf:Encadenamiento>${el('sf:PrimerRegistro', 'S')}</sf:Encadenamiento>`;
  }
  return (
    `<sf:Encadenamiento><sf:RegistroAnterior>` +
    el('sf:IDEmisorFactura', encadenamiento.idEmisorFactura) +
    el('sf:NumSerieFactura', encadenamiento.numSerieFactura) +
    el('sf:FechaExpedicionFactura', encadenamiento.fechaExpedicionFactura) +
    el('sf:Huella', encadenamiento.huella) +
    `</sf:RegistroAnterior></sf:Encadenamiento>`
  );
}

function sistemaInformaticoXml(sistema: SistemaInformatico): string {
  return (
    `<sf:SistemaInformatico>` +
    el('sf:NombreRazon', sistema.productor.nombreRazon) +
    el('sf:NIF', sistema.productor.nif) +
    el('sf:NombreSistemaInformatico', sistema.nombreSistemaInformatico) +
    el('sf:IdSistemaInformatico', sistema.idSistemaInformatico) +
    el('sf:Version', sistema.version) +
    el('sf:NumeroInstalacion', sistema.numeroInstalacion) +
    el('sf:TipoUsoPosibleSoloVerifactu', siNo(sistema.soloVerifactu)) +
    el('sf:TipoUsoPosibleMultiOT', siNo(sistema.multiObligado)) +
    el('sf:IndicadorMultiplesOT', siNo(sistema.usandoMultiObligado)) +
    `</sf:SistemaInformatico>`
  );
}

function desgloseXml(lineas: DesgloseLinea[]): string {
  const detalles = lineas
    .map(
      (linea) =>
        `<sf:DetalleDesglose>` +
        el('sf:Impuesto', linea.impuesto) +
        el('sf:ClaveRegimen', linea.claveRegimen) +
        el('sf:CalificacionOperacion', linea.calificacionOperacion) +
        el('sf:TipoImpositivo', linea.tipoImpositivo) +
        el('sf:BaseImponibleOimporteNoSujeto', linea.baseImponible) +
        el('sf:CuotaRepercutida', linea.cuotaRepercutida) +
        `</sf:DetalleDesglose>`,
    )
    .join('');
  return `<sf:Desglose>${detalles}</sf:Desglose>`;
}

/** `RegistroAlta` completo. El orden de los hijos NO es negociable. */
export function registroAltaXml(
  registro: RegistroAlta,
  sistema: SistemaInformatico,
): string {
  const destinatarios = registro.destinatarios?.length
    ? `<sf:Destinatarios>${registro.destinatarios
        .map((d) => partyXml('sf:IDDestinatario', d))
        .join('')}</sf:Destinatarios>`
    : '';

  return (
    `<sf:RegistroAlta>` +
    el('sf:IDVersion', ID_VERSION) +
    `<sf:IDFactura>` +
    el('sf:IDEmisorFactura', registro.idEmisorFactura) +
    el('sf:NumSerieFactura', registro.numSerieFactura) +
    el('sf:FechaExpedicionFactura', registro.fechaExpedicionFactura) +
    `</sf:IDFactura>` +
    el('sf:NombreRazonEmisor', registro.nombreRazonEmisor) +
    (registro.subsanacion ? el('sf:Subsanacion', 'S') : '') +
    (registro.rechazoPrevio ? el('sf:RechazoPrevio', 'S') : '') +
    el('sf:TipoFactura', registro.tipoFactura) +
    optional('sf:FechaOperacion', registro.fechaOperacion) +
    el('sf:DescripcionOperacion', registro.descripcionOperacion) +
    destinatarios +
    desgloseXml(registro.desglose) +
    el('sf:CuotaTotal', registro.cuotaTotal) +
    el('sf:ImporteTotal', registro.importeTotal) +
    encadenamientoXml(registro.encadenamiento) +
    sistemaInformaticoXml(sistema) +
    el('sf:FechaHoraHusoGenRegistro', registro.fechaHoraHusoGenRegistro) +
    el('sf:TipoHuella', TIPO_HUELLA_SHA256) +
    el('sf:Huella', registro.huella) +
    `</sf:RegistroAlta>`
  );
}

/** `RegistroAnulacion` completo. */
export function registroAnulacionXml(
  registro: RegistroAnulacion,
  sistema: SistemaInformatico,
): string {
  return (
    `<sf:RegistroAnulacion>` +
    el('sf:IDVersion', ID_VERSION) +
    `<sf:IDFactura>` +
    el('sf:IDEmisorFacturaAnulada', registro.idEmisorFacturaAnulada) +
    el('sf:NumSerieFacturaAnulada', registro.numSerieFacturaAnulada) +
    el(
      'sf:FechaExpedicionFacturaAnulada',
      registro.fechaExpedicionFacturaAnulada,
    ) +
    `</sf:IDFactura>` +
    (registro.sinRegistroPrevio ? el('sf:SinRegistroPrevio', 'S') : '') +
    encadenamientoXml(registro.encadenamiento) +
    sistemaInformaticoXml(sistema) +
    el('sf:FechaHoraHusoGenRegistro', registro.fechaHoraHusoGenRegistro) +
    el('sf:TipoHuella', TIPO_HUELLA_SHA256) +
    el('sf:Huella', registro.huella) +
    `</sf:RegistroAnulacion>`
  );
}

/** Cabecera del envío, con `Representante` solo si lo hay. */
export function cabeceraXml(cabecera: Cabecera): string {
  return (
    `<sfLR:Cabecera>` +
    partyXml('sf:ObligadoEmision', cabecera.obligado) +
    (cabecera.representante
      ? partyXml('sf:Representante', cabecera.representante)
      : '') +
    `</sfLR:Cabecera>`
  );
}

/** Máximo de registros por envío que admite `SuministroLR.xsd`. */
export const MAX_REGISTROS_POR_ENVIO = 1000;

/**
 * Cuerpo del suministro. Se valida el límite aquí y no en el servicio para
 * que sea imposible construir un lote inválido, venga de donde venga.
 */
export function regFactuXml(
  cabecera: Cabecera,
  registros: RegistroFactura[],
  sistema: SistemaInformatico,
): string {
  if (registros.length === 0) {
    throw new Error(
      'Un envío debe llevar al menos un registro de facturación.',
    );
  }
  if (registros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `Un envío admite como máximo ${MAX_REGISTROS_POR_ENVIO} registros (recibidos: ${registros.length}).`,
    );
  }

  const lineas = registros
    .map(
      (registro) =>
        `<sfLR:RegistroFactura>` +
        (registro.tipo === 'alta'
          ? registroAltaXml(registro.datos, sistema)
          : registroAnulacionXml(registro.datos, sistema)) +
        `</sfLR:RegistroFactura>`,
    )
    .join('');

  return (
    `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS.sfLR}" xmlns:sf="${NS.sf}">` +
    cabeceraXml(cabecera) +
    lineas +
    `</sfLR:RegFactuSistemaFacturacion>`
  );
}

/**
 * Envoltorio SOAP 1.1 (`document/literal`, según el binding del WSDL).
 *
 * No lleva cabecera SOAP ni firma: en modo VERI\*FACTU la autenticación es el
 * certificado del propio canal TLS, y los registros no se firman uno a uno.
 */
export function soapEnvelope(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS.soap}">` +
    `<soapenv:Body>${body}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}
