import {
  VerifactuSoapFault,
  estadoRegistroAEstado,
  parseRespuesta,
} from './verifactu-response';
import { VERIFACTU_PATH, verifactuEndpoint } from './verifactu-endpoints';

/** Envuelve un cuerpo como lo haría el servicio, con prefijos arbitrarios. */
function respuesta(cuerpo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<env:Body>${cuerpo}</env:Body></env:Envelope>`
  );
}

function conLineas(estadoEnvio: string, lineas: string, extra = ''): string {
  return respuesta(
    `<tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="urn:x">` +
      extra +
      `<tikR:EstadoEnvio>${estadoEnvio}</tikR:EstadoEnvio>` +
      `<tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio>` +
      lineas +
      `</tikR:RespuestaRegFactuSistemaFacturacion>`,
  );
}

const LINEA_OK =
  `<tikR:RespuestaLinea>` +
  `<tikR:IDFactura>` +
  `<tikR:IDEmisorFactura>16612808T</tikR:IDEmisorFactura>` +
  `<tikR:NumSerieFactura>DOM-2026-0001</tikR:NumSerieFactura>` +
  `<tikR:FechaExpedicionFactura>08-08-2026</tikR:FechaExpedicionFactura>` +
  `</tikR:IDFactura>` +
  `<tikR:Operacion>Alta</tikR:Operacion>` +
  `<tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro>` +
  `</tikR:RespuestaLinea>`;

describe('verifactuEndpoint', () => {
  // Salen del soap:address del WSDL oficial. Las entradas están segregadas
  // por tipo de certificado y equivocarse rompe el handshake TLS, no el XML:
  // el síntoma no apunta a la causa, así que conviene fijarlo con pruebas.
  it('usa www1/prewww1 para el certificado normal', () => {
    expect(verifactuEndpoint('produccion', 'normal')).toBe(
      `https://www1.agenciatributaria.gob.es${VERIFACTU_PATH}`,
    );
    expect(verifactuEndpoint('preproduccion', 'normal')).toBe(
      `https://prewww1.aeat.es${VERIFACTU_PATH}`,
    );
  });

  it('usa www10/prewww10 para el certificado de sello', () => {
    expect(verifactuEndpoint('produccion', 'sello')).toBe(
      `https://www10.agenciatributaria.gob.es${VERIFACTU_PATH}`,
    );
    expect(verifactuEndpoint('preproduccion', 'sello')).toBe(
      `https://prewww10.aeat.es${VERIFACTU_PATH}`,
    );
  });

  it('nunca mezcla preproducción con un host de producción', () => {
    for (const cert of ['normal', 'sello'] as const) {
      expect(verifactuEndpoint('preproduccion', cert)).toContain('aeat.es');
      expect(verifactuEndpoint('preproduccion', cert)).not.toContain(
        'agenciatributaria.gob.es',
      );
    }
  });
});

describe('parseRespuesta', () => {
  it('lee un envío aceptado por completo', () => {
    const r = parseRespuesta(
      conLineas('Correcto', LINEA_OK, `<tikR:CSV>A-123456</tikR:CSV>`),
    );
    expect(r.estadoEnvio).toBe('Correcto');
    expect(r.csv).toBe('A-123456');
    expect(r.tiempoEsperaSegundos).toBe(60);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].estado).toBe('Correcto');
    expect(r.lineas[0].numSerieFactura).toBe('DOM-2026-0001');
  });

  it('no depende de los prefijos de namespace que use la AEAT', () => {
    const conOtroPrefijo = conLineas('Correcto', LINEA_OK).replace(
      /tikR:/g,
      'otro:',
    );
    expect(parseRespuesta(conOtroPrefijo).estadoEnvio).toBe('Correcto');
  });

  it('devuelve varias líneas cuando el lote lleva varios registros', () => {
    const segunda = LINEA_OK.replace('DOM-2026-0001', 'DOM-2026-0002');
    const r = parseRespuesta(conLineas('Correcto', LINEA_OK + segunda));
    expect(r.lineas.map((l) => l.numSerieFactura)).toEqual([
      'DOM-2026-0001',
      'DOM-2026-0002',
    ]);
  });

  it('conserva el número de factura como texto', () => {
    // Si se interpretara como número, un "2026001" perdería su forma y no
    // casaría con nuestro registro. Es la razón de parseTagValue: false.
    const numerico = LINEA_OK.replace('DOM-2026-0001', '2026001');
    const r = parseRespuesta(conLineas('Correcto', numerico));
    expect(r.lineas[0].numSerieFactura).toBe('2026001');
    expect(typeof r.lineas[0].numSerieFactura).toBe('string');
  });

  it('lee el detalle de un registro incorrecto', () => {
    const malo = LINEA_OK.replace(
      '<tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro>',
      `<tikR:EstadoRegistro>Incorrecto</tikR:EstadoRegistro>` +
        `<tikR:CodigoErrorRegistro>1101</tikR:CodigoErrorRegistro>` +
        `<tikR:DescripcionErrorRegistro>NIF no identificado</tikR:DescripcionErrorRegistro>`,
    );
    const r = parseRespuesta(conLineas('Incorrecto', malo));
    expect(r.lineas[0].estado).toBe('Incorrecto');
    expect(r.lineas[0].codigoError).toBe('1101');
    expect(r.lineas[0].descripcionError).toBe('NIF no identificado');
  });

  it('desescapa las entidades de la descripción del error', () => {
    const malo = LINEA_OK.replace(
      '<tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro>',
      `<tikR:EstadoRegistro>Incorrecto</tikR:EstadoRegistro>` +
        `<tikR:DescripcionErrorRegistro>Emisor &amp; destinatario coinciden</tikR:DescripcionErrorRegistro>`,
    );
    expect(
      parseRespuesta(conLineas('Incorrecto', malo)).lineas[0].descripcionError,
    ).toBe('Emisor & destinatario coinciden');
  });

  it('lee el nodo de registro duplicado', () => {
    const dup = LINEA_OK.replace(
      '</tikR:RespuestaLinea>',
      `<tikR:RegistroDuplicado>` +
        `<tikR:IdPeticionRegistroDuplicado>PET-1</tikR:IdPeticionRegistroDuplicado>` +
        `<tikR:EstadoRegistroDuplicado>Correcta</tikR:EstadoRegistroDuplicado>` +
        `</tikR:RegistroDuplicado></tikR:RespuestaLinea>`,
    );
    const r = parseRespuesta(conLineas('Incorrecto', dup));
    expect(r.lineas[0].duplicado?.idPeticion).toBe('PET-1');
    expect(r.lineas[0].duplicado?.estado).toBe('Correcta');
  });

  it('casa las líneas de una anulación, que usa los campos "Anulada"', () => {
    const anulacion =
      `<tikR:RespuestaLinea><tikR:IDFactura>` +
      `<tikR:IDEmisorFacturaAnulada>16612808T</tikR:IDEmisorFacturaAnulada>` +
      `<tikR:NumSerieFacturaAnulada>DOM-2026-0001</tikR:NumSerieFacturaAnulada>` +
      `<tikR:FechaExpedicionFacturaAnulada>08-08-2026</tikR:FechaExpedicionFacturaAnulada>` +
      `</tikR:IDFactura><tikR:Operacion>Anulacion</tikR:Operacion>` +
      `<tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro></tikR:RespuestaLinea>`;
    const r = parseRespuesta(conLineas('Correcto', anulacion));
    expect(r.lineas[0].numSerieFactura).toBe('DOM-2026-0001');
    expect(r.lineas[0].operacion).toBe('Anulacion');
  });

  it('acepta un envío parcialmente correcto', () => {
    const malo = LINEA_OK.replace(
      'Correcto</tikR:EstadoRegistro>',
      'Incorrecto</tikR:EstadoRegistro>',
    );
    const r = parseRespuesta(
      conLineas('ParcialmenteCorrecto', LINEA_OK + malo),
    );
    expect(r.estadoEnvio).toBe('ParcialmenteCorrecto');
    expect(r.lineas.map((l) => l.estado)).toEqual(['Correcto', 'Incorrecto']);
  });

  it('un envío rechazado puede no traer ninguna línea', () => {
    const r = parseRespuesta(conLineas('Incorrecto', ''));
    expect(r.lineas).toEqual([]);
  });
});

describe('parseRespuesta ante fallos', () => {
  it('convierte un SOAP Fault en un error tipado', () => {
    const xml = respuesta(
      `<env:Fault><faultcode>env:Client</faultcode>` +
        `<faultstring>Certificado no autorizado</faultstring></env:Fault>`,
    );
    expect(() => parseRespuesta(xml)).toThrow(VerifactuSoapFault);
    expect(() => parseRespuesta(xml)).toThrow(/Certificado no autorizado/);
  });

  it('rechaza un cuerpo que no es una respuesta de suministro', () => {
    expect(() => parseRespuesta(respuesta('<Otra/>'))).toThrow(
      VerifactuSoapFault,
    );
  });

  it('rechaza una respuesta sin EstadoEnvio', () => {
    const xml = respuesta(
      `<RespuestaRegFactuSistemaFacturacion><CSV>X</CSV></RespuestaRegFactuSistemaFacturacion>`,
    );
    expect(() => parseRespuesta(xml)).toThrow(/EstadoEnvio/);
  });

  it('rechaza algo que no es un sobre SOAP', () => {
    expect(() => parseRespuesta('<html>Error 500</html>')).toThrow(
      VerifactuSoapFault,
    );
  });
});

describe('estadoRegistroAEstado', () => {
  it('traduce cada estado de la AEAT al nuestro', () => {
    expect(estadoRegistroAEstado('Correcto')).toBe('aceptado');
    expect(estadoRegistroAEstado('Incorrecto')).toBe('rechazado');
  });

  it('«aceptado con errores» NO es un fallo: el registro quedó registrado', () => {
    // Reintentarlo produciría un duplicado. Se corrige con subsanación.
    expect(estadoRegistroAEstado('AceptadoConErrores')).toBe(
      'aceptado_con_errores',
    );
  });
});
