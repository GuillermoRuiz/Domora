import {
  amountsEquivalent,
  buildAltaHashInput,
  buildAnulacionHashInput,
  canonicalAmount,
  computeHash,
  formatSpanishDate,
  formatTimestampWithZone,
} from './verifactu-hash';

/**
 * Los tres casos del apartado 6 del documento normativo de la AEAT «Detalle
 * de las especificaciones técnicas para generación de la huella o hash de los
 * registros de facturación», v0.1.2 (27/08/2024).
 *
 * Esto no es un test de comportamiento: es el **criterio de conformidad**. Si
 * alguno de los tres deja de coincidir, la implementación se ha desviado de
 * la norma y los registros que emita serán rechazados o marcados como
 * "aceptado con errores" por la AEAT, que recalcula la huella al recibirlos.
 */
describe('Conformidad con los vectores oficiales de la AEAT', () => {
  it('Caso 1: primer registro de alta (sin huella anterior)', () => {
    const input = buildAltaHashInput({
      idEmisorFactura: '89890001K',
      numSerieFactura: '12345678/G33',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '12.35',
      importeTotal: '123.45',
      huella: '',
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
    });

    expect(input).toBe(
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&' +
        'FechaExpedicionFactura=01-01-2024&TipoFactura=F1&' +
        'CuotaTotal=12.35&ImporteTotal=123.45&Huella=&' +
        'FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    );
    expect(computeHash(input)).toBe(
      '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
    );
  });

  it('Caso 2: alta encadenada a un registro anterior', () => {
    const input = buildAltaHashInput({
      idEmisorFactura: '89890001K',
      numSerieFactura: '12345679/G34',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '12.35',
      importeTotal: '123.45',
      huella:
        '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00',
    });

    expect(computeHash(input)).toBe(
      'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
    );
  });

  it('Caso 3: anulación encadenada a un registro anterior', () => {
    const input = buildAnulacionHashInput({
      idEmisorFacturaAnulada: '89890001K',
      numSerieFacturaAnulada: '12345679/G34',
      fechaExpedicionFacturaAnulada: '01-01-2024',
      huella:
        'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
    });

    expect(computeHash(input)).toBe(
      '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68',
    );
  });

  it('los tres casos forman una cadena: cada huella alimenta la siguiente', () => {
    // Es el punto del ejercicio: el caso 2 encadena con el 1 y el 3 con el 2.
    const first = computeHash(
      buildAltaHashInput({
        idEmisorFactura: '89890001K',
        numSerieFactura: '12345678/G33',
        fechaExpedicionFactura: '01-01-2024',
        tipoFactura: 'F1',
        cuotaTotal: '12.35',
        importeTotal: '123.45',
        huella: '',
        fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
      }),
    );
    const second = computeHash(
      buildAltaHashInput({
        idEmisorFactura: '89890001K',
        numSerieFactura: '12345679/G34',
        fechaExpedicionFactura: '01-01-2024',
        tipoFactura: 'F1',
        cuotaTotal: '12.35',
        importeTotal: '123.45',
        huella: first,
        fechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00',
      }),
    );
    const third = computeHash(
      buildAnulacionHashInput({
        idEmisorFacturaAnulada: '89890001K',
        numSerieFacturaAnulada: '12345679/G34',
        fechaExpedicionFacturaAnulada: '01-01-2024',
        huella: second,
        fechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
      }),
    );
    expect(third).toBe(
      '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68',
    );
  });
});

describe('Reglas de formato de la norma', () => {
  it('conserva los espacios interiores y quita solo los extremos', () => {
    // Ejemplo literal del documento: " 12345678 / G33 " -> "12345678 / G33".
    const input = buildAltaHashInput({
      idEmisorFactura: '89890001K',
      numSerieFactura: ' 12345678 / G33 ',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '12.35',
      importeTotal: '123.45',
      huella: '',
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
    });
    expect(input).toContain('NumSerieFactura=12345678 / G33&');
  });

  it('no escapa la barra del número de factura', () => {
    // El escapado es cosa del QR (query string), no de la huella.
    expect(
      buildAltaHashInput({
        idEmisorFactura: 'B1',
        numSerieFactura: '12345678/G33',
        fechaExpedicionFactura: '01-01-2024',
        tipoFactura: 'F1',
        cuotaTotal: '1.00',
        importeTotal: '1.00',
        huella: '',
        fechaHoraHusoGenRegistro: '2024-01-01T00:00:00Z',
      }),
    ).toContain('NumSerieFactura=12345678/G33&');
  });

  it('un campo vacío aparece como "campo="', () => {
    expect(
      buildAltaHashInput({
        idEmisorFactura: 'B1',
        numSerieFactura: 'X',
        fechaExpedicionFactura: '01-01-2024',
        tipoFactura: 'F1',
        cuotaTotal: '1.00',
        importeTotal: '1.00',
        huella: '',
        fechaHoraHusoGenRegistro: '2024-01-01T00:00:00Z',
      }),
    ).toContain('&Huella=&');
  });

  describe('canonicalAmount', () => {
    // Se fija a dos decimales, los MISMOS que irán en el XML: la norma dice
    // que el valor de la huella es «la misma información contenida en el
    // campo correspondiente del fichero XML». Recortar ceros obligaría a
    // confiar en que la AEAT normalice igual que nosotros.
    it('siempre deja dos decimales, incluidos los ceros', () => {
      expect(canonicalAmount('100')).toBe('100.00');
      expect(canonicalAmount('100.0')).toBe('100.00');
      expect(canonicalAmount('123.1')).toBe('123.10');
      expect(canonicalAmount(132.68)).toBe('132.68');
    });
  });

  describe('amountsEquivalent', () => {
    it('aplica la equivalencia que reconoce la norma (123.1 ≡ 123.10)', () => {
      expect(amountsEquivalent('123.1', '123.10')).toBe(true);
      expect(amountsEquivalent('100', '100.00')).toBe(true);
      expect(amountsEquivalent('123.1', '123.11')).toBe(false);
    });
  });

  describe('formatos de fecha', () => {
    it('la fecha de expedición va en dd-mm-aaaa', () => {
      expect(formatSpanishDate(new Date('2024-01-01T00:00:00Z'))).toBe(
        '01-01-2024',
      );
    });

    // La norma exige huso horario; sus ejemplos usan +01:00, pero "Z" es
    // igualmente ISO 8601 con huso (UTC). Lo que importa es que la cadena
    // hasheada sea idéntica a la que se remite en el XML.
    it('el instante de generación lleva huso horario explícito', () => {
      expect(
        formatTimestampWithZone(new Date('2024-01-01T19:20:30.500Z')),
      ).toBe('2024-01-01T19:20:30Z');
    });
  });
});

describe('computeHash', () => {
  it('devuelve 64 caracteres hexadecimales en mayúsculas', () => {
    expect(computeHash('prueba')).toMatch(/^[0-9A-F]{64}$/);
  });

  it('coincide con SHA-256 de referencia', () => {
    expect(computeHash('abc')).toBe(
      'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD',
    );
  });

  it('cambia por completo si cambia un céntimo', () => {
    const base = {
      idEmisorFactura: 'B1',
      numSerieFactura: 'X',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '1.00',
      huella: '',
      fechaHoraHusoGenRegistro: '2024-01-01T00:00:00Z',
    };
    expect(
      computeHash(buildAltaHashInput({ ...base, importeTotal: '1.00' })),
    ).not.toBe(
      computeHash(buildAltaHashInput({ ...base, importeTotal: '1.01' })),
    );
  });
});
