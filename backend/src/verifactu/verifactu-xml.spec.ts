import {
  CALIFICACION_SUJETA_NO_EXENTA,
  CLAVE_REGIMEN_GENERAL,
  ID_VERSION,
  IMPUESTO_IVA,
  MAX_REGISTROS_POR_ENVIO,
  NS,
  TIPO_FACTURA_COMPLETA,
  TIPO_HUELLA_SHA256,
  type Cabecera,
  type RegistroAlta,
  type RegistroAnulacion,
  type RegistroFactura,
  type SistemaInformatico,
  escapeXml,
  regFactuXml,
  soapEnvelope,
} from './verifactu-xml';

/**
 * Estas pruebas comprueban la ESTRUCTURA del XML sin depender de un validador
 * de esquemas: jest no lleva ninguno y meter uno nativo por esto no compensa.
 *
 * La conformidad de verdad se comprobó validando la salida de este mismo
 * serializador contra los XSD oficiales de la AEAT (`SuministroLR.xsd` +
 * `SuministroInformacion.xsd`) con libxml2, incluido un control negativo que
 * confirmó que el validador rechaza enumerados inválidos, orden alterado,
 * namespaces mal puestos, NIF de longitud incorrecta, importes con tres
 * decimales y campos obligatorios ausentes. Lo que se fija aquí son
 * justamente las condiciones que aquel ejercicio demostró que importan.
 */

const sistema: SistemaInformatico = {
  productor: { nombreRazon: 'Domora S.L.', nif: 'B12345678' },
  nombreSistemaInformatico: 'Domora',
  idSistemaInformatico: '01',
  version: '1.0.0',
  numeroInstalacion: 'DOM-PROD-001',
  soloVerifactu: true,
  multiObligado: true,
  usandoMultiObligado: false,
};

const cabecera: Cabecera = {
  obligado: { nombreRazon: 'Domora S.L.', nif: 'B12345678' },
};

const desglose = [
  {
    impuesto: IMPUESTO_IVA,
    claveRegimen: CLAVE_REGIMEN_GENERAL,
    calificacionOperacion: CALIFICACION_SUJETA_NO_EXENTA,
    tipoImpositivo: '21.00',
    baseImponible: '109.65',
    cuotaRepercutida: '23.03',
  },
];

function alta(overrides: Partial<RegistroAlta> = {}): RegistroAlta {
  return {
    idEmisorFactura: 'B12345678',
    numSerieFactura: 'DOM-2026-0001',
    fechaExpedicionFactura: '08-08-2026',
    nombreRazonEmisor: 'Domora S.L.',
    tipoFactura: TIPO_FACTURA_COMPLETA,
    descripcionOperacion: 'Suscripción Domora',
    desglose,
    cuotaTotal: '23.03',
    importeTotal: '132.68',
    encadenamiento: 'primero',
    fechaHoraHusoGenRegistro: '2026-08-08T10:00:00Z',
    huella: 'A'.repeat(64),
    ...overrides,
  };
}

function anulacion(
  overrides: Partial<RegistroAnulacion> = {},
): RegistroAnulacion {
  return {
    idEmisorFacturaAnulada: 'B12345678',
    numSerieFacturaAnulada: 'DOM-2026-0001',
    fechaExpedicionFacturaAnulada: '08-08-2026',
    encadenamiento: 'primero',
    fechaHoraHusoGenRegistro: '2026-08-08T10:10:00Z',
    huella: 'B'.repeat(64),
    ...overrides,
  };
}

function envio(registros: RegistroFactura[], head: Cabecera = cabecera) {
  return regFactuXml(head, registros, sistema);
}

describe('Namespaces', () => {
  // Es el error que más caro sale: ambos esquemas declaran
  // elementFormDefault="qualified", pero Cabecera y RegistroFactura se
  // declaran en SuministroLR mientras que sus hijos vienen de tipos definidos
  // en SuministroInformacion. Se validó que un ObligadoEmision en el
  // namespace equivocado invalida el envío entero.
  const xml = envio([{ tipo: 'alta', datos: alta() }]);

  it('declara ambos namespaces en la raíz', () => {
    expect(xml).toContain(`xmlns:sfLR="${NS.sfLR}"`);
    expect(xml).toContain(`xmlns:sf="${NS.sf}"`);
  });

  it('Cabecera y RegistroFactura van en el namespace de SuministroLR', () => {
    expect(xml).toContain('<sfLR:Cabecera>');
    expect(xml).toContain('<sfLR:RegistroFactura>');
  });

  it('los hijos de Cabecera van en el de SuministroInformacion', () => {
    expect(xml).toContain('<sf:ObligadoEmision>');
    expect(xml).not.toContain('<sfLR:ObligadoEmision>');
  });

  it('RegistroAlta es un elemento global de SuministroInformacion', () => {
    expect(xml).toContain('<sf:RegistroAlta>');
  });
});

describe('Cabecera', () => {
  it('sin representante, no emite el elemento', () => {
    expect(envio([{ tipo: 'alta', datos: alta() }])).not.toContain(
      'Representante',
    );
  });

  it('con representante, lo emite después del obligado', () => {
    // Es el mecanismo con el que un tercero suministra en nombre del obligado
    // usando su PROPIO certificado, sin custodiar el ajeno.
    const xml = envio([{ tipo: 'alta', datos: alta() }], {
      obligado: { nombreRazon: 'Gestora Demo S.L.', nif: 'B00000001' },
      representante: { nombreRazon: 'Domora S.L.', nif: 'B12345678' },
    });
    expect(xml.indexOf('<sf:ObligadoEmision>')).toBeLessThan(
      xml.indexOf('<sf:Representante>'),
    );
    expect(xml).toContain(
      '<sf:Representante><sf:NombreRazon>Domora S.L.</sf:NombreRazon><sf:NIF>B12345678</sf:NIF></sf:Representante>',
    );
  });
});

describe('RegistroAlta', () => {
  it('respeta el orden del xs:sequence', () => {
    const xml = envio([
      { tipo: 'alta', datos: alta({ fechaOperacion: '01-08-2026' }) },
    ]);
    const orden = [
      'sf:IDVersion',
      'sf:IDFactura',
      'sf:NombreRazonEmisor',
      'sf:TipoFactura',
      'sf:FechaOperacion',
      'sf:DescripcionOperacion',
      'sf:Desglose',
      'sf:CuotaTotal',
      'sf:ImporteTotal',
      'sf:Encadenamiento',
      'sf:SistemaInformatico',
      'sf:FechaHoraHusoGenRegistro',
      'sf:TipoHuella',
      'sf:Huella>',
    ];
    const posiciones = orden.map((tag) => xml.indexOf(`<${tag}`));
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    expect(posiciones.every((p) => p >= 0)).toBe(true);
  });

  it('fija la versión y el tipo de huella que exige el esquema', () => {
    const xml = envio([{ tipo: 'alta', datos: alta() }]);
    expect(xml).toContain(`<sf:IDVersion>${ID_VERSION}</sf:IDVersion>`);
    expect(xml).toContain(
      `<sf:TipoHuella>${TIPO_HUELLA_SHA256}</sf:TipoHuella>`,
    );
  });

  it('omite FechaOperacion si no se indica', () => {
    expect(envio([{ tipo: 'alta', datos: alta() }])).not.toContain(
      'FechaOperacion',
    );
  });

  it('marca la subsanación solo cuando corresponde', () => {
    expect(envio([{ tipo: 'alta', datos: alta() }])).not.toContain(
      'Subsanacion',
    );
    expect(
      envio([{ tipo: 'alta', datos: alta({ subsanacion: true }) }]),
    ).toContain('<sf:Subsanacion>S</sf:Subsanacion>');
  });

  it('marca RechazoPrevio solo cuando corresponde, después de Subsanacion', () => {
    // Son mutuamente excluyentes en la práctica: Subsanacion corrige un
    // registro que la AEAT SÍ aceptó, RechazoPrevio reenvía uno que rechazó
    // de plano. Lo importante aquí es el orden: el xs:sequence pone
    // Subsanacion antes que RechazoPrevio.
    expect(envio([{ tipo: 'alta', datos: alta() }])).not.toContain(
      'RechazoPrevio',
    );
    const xml = envio([{ tipo: 'alta', datos: alta({ rechazoPrevio: true }) }]);
    expect(xml).toContain('<sf:RechazoPrevio>S</sf:RechazoPrevio>');
    expect(xml.indexOf('sf:NombreRazonEmisor')).toBeLessThan(
      xml.indexOf('sf:RechazoPrevio'),
    );
    expect(xml.indexOf('sf:RechazoPrevio')).toBeLessThan(
      xml.indexOf('sf:TipoFactura'),
    );
  });

  it('emite los destinatarios cuando los hay', () => {
    const xml = envio([
      {
        tipo: 'alta',
        datos: alta({
          destinatarios: [
            { nombreRazon: 'Gestora Demo S.L.', nif: 'B00000001' },
          ],
        }),
      },
    ]);
    expect(xml).toContain('<sf:Destinatarios><sf:IDDestinatario>');
  });
});

describe('Encadenamiento', () => {
  it('el primer registro usa PrimerRegistro=S', () => {
    const xml = envio([{ tipo: 'alta', datos: alta() }]);
    expect(xml).toContain(
      '<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>',
    );
    expect(xml).not.toContain('RegistroAnterior');
  });

  it('los siguientes identifican al anterior, no solo su huella', () => {
    // El esquema pide los datos de la factura anterior además de la huella:
    // con guardar previousHash no basta para reconstruir el envío.
    const xml = envio([
      {
        tipo: 'alta',
        datos: alta({
          encadenamiento: {
            idEmisorFactura: 'B12345678',
            numSerieFactura: 'DOM-2026-0000',
            fechaExpedicionFactura: '07-08-2026',
            huella: 'C'.repeat(64),
          },
        }),
      },
    ]);
    expect(xml).toContain('<sf:RegistroAnterior>');
    expect(xml).toContain(
      '<sf:NumSerieFactura>DOM-2026-0000</sf:NumSerieFactura>',
    );
    expect(xml).not.toContain('PrimerRegistro');
  });
});

describe('RegistroAnulacion', () => {
  it('usa los campos "Anulada" y no lleva desglose ni importes', () => {
    const xml = envio([{ tipo: 'anulacion', datos: anulacion() }]);
    expect(xml).toContain('<sf:RegistroAnulacion>');
    expect(xml).toContain('<sf:IDEmisorFacturaAnulada>');
    expect(xml).toContain('<sf:NumSerieFacturaAnulada>');
    expect(xml).not.toContain('Desglose');
    expect(xml).not.toContain('ImporteTotal');
  });

  it('marca SinRegistroPrevio solo cuando corresponde, justo tras IDFactura', () => {
    // Confirmado contra preproducción: sin este campo, anular una factura
    // cuyo Alta fue rechazada (nunca se registró) vuelve con "No existe el
    // registro de facturación" (código 3002).
    expect(envio([{ tipo: 'anulacion', datos: anulacion() }])).not.toContain(
      'SinRegistroPrevio',
    );
    const xml = envio([
      { tipo: 'anulacion', datos: anulacion({ sinRegistroPrevio: true }) },
    ]);
    expect(xml).toContain('<sf:SinRegistroPrevio>S</sf:SinRegistroPrevio>');
    expect(xml.indexOf('</sf:IDFactura>')).toBeLessThan(
      xml.indexOf('sf:SinRegistroPrevio'),
    );
    expect(xml.indexOf('sf:SinRegistroPrevio')).toBeLessThan(
      xml.indexOf('sf:Encadenamiento'),
    );
  });
});

describe('SistemaInformatico', () => {
  it('traduce los booleanos al enumerado S/N del esquema', () => {
    const xml = envio([{ tipo: 'alta', datos: alta() }]);
    expect(xml).toContain(
      '<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>',
    );
    expect(xml).toContain(
      '<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>',
    );
  });

  it('identifica al productor del software, no al obligado', () => {
    const xml = envio([{ tipo: 'alta', datos: alta() }], {
      obligado: { nombreRazon: 'Gestora Demo S.L.', nif: 'B00000001' },
    });
    expect(xml).toContain(
      '<sf:SistemaInformatico><sf:NombreRazon>Domora S.L.</sf:NombreRazon>',
    );
  });
});

describe('Escapado', () => {
  it('escapa los caracteres reservados de XML', () => {
    expect(escapeXml('Gestión & Cía <"test">')).toBe(
      'Gestión &amp; Cía &lt;&quot;test&quot;&gt;',
    );
  });

  it('una razón social con & no rompe el documento', () => {
    const xml = envio([
      {
        tipo: 'alta',
        datos: alta({ descripcionOperacion: 'Gestión & obras' }),
      },
    ]);
    expect(xml).toContain('Gestión &amp; obras');
    expect(xml).not.toContain('Gestión & obras');
  });
});

describe('Límites del envío', () => {
  it('rechaza un envío vacío', () => {
    expect(() => envio([])).toThrow(/al menos un registro/);
  });

  it(`rechaza más de ${MAX_REGISTROS_POR_ENVIO} registros`, () => {
    const muchos: RegistroFactura[] = Array.from(
      { length: MAX_REGISTROS_POR_ENVIO + 1 },
      () => ({ tipo: 'alta' as const, datos: alta() }),
    );
    expect(() => envio(muchos)).toThrow(/como máximo/);
  });

  it('admite exactamente el máximo', () => {
    const justos: RegistroFactura[] = Array.from(
      { length: MAX_REGISTROS_POR_ENVIO },
      () => ({ tipo: 'alta' as const, datos: alta() }),
    );
    expect(() => envio(justos)).not.toThrow();
  });

  it('mantiene el orden de los registros del lote', () => {
    const xml = envio([
      { tipo: 'alta', datos: alta({ numSerieFactura: 'DOM-1' }) },
      { tipo: 'alta', datos: alta({ numSerieFactura: 'DOM-2' }) },
    ]);
    expect(xml.indexOf('DOM-1')).toBeLessThan(xml.indexOf('DOM-2'));
  });
});

describe('soapEnvelope', () => {
  it('envuelve el cuerpo en un Envelope de SOAP 1.1', () => {
    // El binding del WSDL es document/literal sobre SOAP 1.1.
    const xml = soapEnvelope(envio([{ tipo: 'alta', datos: alta() }]));
    expect(xml).toContain(`<soapenv:Envelope xmlns:soapenv="${NS.soap}">`);
    expect(xml).toContain('<soapenv:Body>');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('no añade cabecera SOAP: en VERI*FACTU autentica el certificado del canal', () => {
    expect(soapEnvelope('<x/>')).not.toContain('Header');
  });
});
