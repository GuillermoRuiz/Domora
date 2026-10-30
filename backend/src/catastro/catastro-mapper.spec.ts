import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asArray,
  mapPropertyType,
  mapViaType,
  parseMunicipalities,
  parseParcel,
  parseProvinces,
  parseSpanishNumber,
  parseStreets,
  titleCase,
} from './catastro-mapper';
import { CatastroError } from './catastro.types';

/** Respuestas REALES del servicio, grabadas el 2026-09-20 (ver `fixtures/`). */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
}

describe('catastro-mapper', () => {
  describe('helpers', () => {
    it('parseSpanishNumber: coma decimal, punto de miles y vacíos', () => {
      expect(parseSpanishNumber('2,150000')).toBe(2.15);
      expect(parseSpanishNumber('3.276')).toBe(3276); // sfc con separador de miles
      expect(parseSpanishNumber('41')).toBe(41);
      expect(parseSpanishNumber('')).toBeNull();
      expect(parseSpanishNumber(undefined)).toBeNull();
      expect(parseSpanishNumber('abc')).toBeNull();
    });

    it('asArray normaliza objeto único, array y ausencia', () => {
      expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
      expect(asArray([1, 2])).toEqual([1, 2]);
      expect(asArray(undefined)).toEqual([]);
    });

    it('titleCase pasa MAYÚSCULAS a nombre propio y respeta las partículas', () => {
      expect(titleCase('ALCALA DE HENARES')).toBe('Alcala de Henares');
      expect(titleCase('  MADRID ')).toBe('Madrid');
      expect(titleCase('')).toBeNull();
    });

    it('mapViaType: siglas conocidas y fallback a Otro', () => {
      expect(mapViaType('CL')).toBe('Calle');
      expect(mapViaType('av')).toBe('Avenida');
      expect(mapViaType('ZZ')).toBe('Otro');
      expect(mapViaType(undefined)).toBeNull();
    });

    it('mapPropertyType: uso catastral → tipo (sin depender de tildes/mayúsculas)', () => {
      expect(mapPropertyType('Residencial', false)).toBe('Piso');
      expect(mapPropertyType('Residencial', true)).toBe('Casa');
      expect(mapPropertyType('Almacen-Estacionamiento', false)).toBe('Parking');
      expect(mapPropertyType('ALMACÉN-ESTACIONAMIENTO', false)).toBe('Parking');
      expect(mapPropertyType('Comercial', false)).toBe('Local');
      expect(mapPropertyType('Oficinas', false)).toBe('Local');
      expect(mapPropertyType(null, false)).toBe('Local');
    });
  });

  describe('parseParcel — edificio con lista de unidades (Consulta_DNPRC, RC de 14)', () => {
    const parcel = parseParcel(fixture('building-list.json'));

    it('devuelve las 34 unidades y la referencia de la parcela', () => {
      expect(parcel.units).toHaveLength(34);
      expect(parcel.parcelReference).toBe('2853604VK4725D');
    });

    it('ensambla la RC de 20 caracteres (pc1+pc2+car+cc1+cc2)', () => {
      expect(parcel.units[0].cadastralReference).toBe('2853604VK4725D0001YP');
      expect(
        parcel.units.every((u) => u.cadastralReference.length === 20),
      ).toBe(true);
    });

    it('mapea dirección, escalera/planta/puerta y uso de la primera unidad', () => {
      expect(parcel.units[0]).toMatchObject({
        type: 'Local',
        use: 'Comercial',
        viaType: 'Calle',
        viaName: 'Alcala',
        streetNumber: '100',
        staircase: '1',
        floor: 'Bajo', // pt "00"
        door: 'B',
        postalCode: '28009',
        municipality: 'Madrid',
        province: 'Madrid',
        builtAreaM2: 41,
        participationQuota: 2.15,
      });
    });

    it('conserva la planta negativa (sótano) y los códigos de puerta del Catastro', () => {
      expect(parcel.units.map((u) => u.floor)).toContain('-1');
      expect(parcel.units.map((u) => u.door)).toEqual(
        expect.arrayContaining(['IZ', 'DR']),
      );
    });

    it('los coeficientes suman 100 (validación cruzada de que el parseo es correcto)', () => {
      const sum = parcel.units.reduce(
        (a, u) => a + (u.participationQuota ?? 0),
        0,
      );
      expect(sum).toBeCloseTo(100, 1);
    });

    it('la misma dirección (Consulta_DNPLOC) produce el mismo resultado', () => {
      const byAddress = parseParcel(fixture('by-address.json'));
      expect(byAddress.units.map((u) => u.cadastralReference)).toEqual(
        parcel.units.map((u) => u.cadastralReference),
      );
    });
  });

  describe('parseParcel — inmueble único (bico)', () => {
    it('una unidad de una parcela con varios inmuebles se queda como Local (no Casa)', () => {
      const parcel = parseParcel(fixture('single-unit.json'));
      expect(parcel.units).toHaveLength(1);
      expect(parcel.units[0]).toMatchObject({
        cadastralReference: '2853604VK4725D0001YP',
        type: 'Local',
        floor: 'Bajo',
        door: 'B',
      });
    });

    it('una parcela SIN división horizontal (respuesta real) es unifamiliar y los marcadores T/OD/OS no son datos', () => {
      const [unit] = parseParcel(fixture('undivided-parcel.json')).units;
      expect(unit).toMatchObject({
        staircase: null,
        floor: null,
        door: null,
        use: 'Industrial',
        type: 'Local',
      });
    });

    it('una vivienda residencial en parcela sin división se sugiere como Casa', () => {
      const json = JSON.parse(JSON.stringify(fixture('undivided-parcel.json')));
      json.consulta_dnprcResult.bico.bi.debi.luso = 'Residencial';
      expect(parseParcel(json).units[0].type).toBe('Casa');
    });

    it('sfc con separador de miles no se lee como decimal', () => {
      const json = JSON.parse(JSON.stringify(fixture('single-unit.json')));
      json.consulta_dnprcResult.bico.bi.debi.sfc = '3.276';
      expect(parseParcel(json).units[0].builtAreaM2).toBe(3276);
    });
  });

  describe('parseParcel — formas defensivas y rústicos', () => {
    it('una lista con UN solo elemento llegando como objeto (no array) también se lee', () => {
      const json = JSON.parse(JSON.stringify(fixture('building-list.json')));
      json.consulta_dnprcResult.lrcdnp.rcdnp =
        json.consulta_dnprcResult.lrcdnp.rcdnp[0];
      expect(parseParcel(json).units).toHaveLength(1);
    });

    it('un inmueble rústico real (sin dirección urbana) se importa sin vía y con aviso', () => {
      const parcel = parseParcel(fixture('rustic-parcel.json'));
      expect(parcel.units).toHaveLength(1);
      expect(parcel.units[0]).toMatchObject({
        cadastralReference: expect.any(String),
        viaName: null,
        postalCode: null,
        participationQuota: null,
        builtAreaM2: 3095,
        type: 'Local',
      });
      expect(parcel.units[0].cadastralReference).toHaveLength(20);
      expect(parcel.warnings[0]).toMatch(/rústico/);
    });

    it('sin ningún inmueble → not_found', () => {
      expect(() =>
        parseParcel({ consulta_dnprcResult: { control: { cudnp: 0 } } }),
      ).toThrow(CatastroError);
    });
  });

  describe('errores dentro de un HTTP 200', () => {
    it.each([
      ['err-number.json', 'not_found', '43'],
      ['err-street.json', 'not_found', '33'],
      ['err-length.json', 'invalid', '3'],
    ])('%s → %s (cod %s)', (file, kind, code) => {
      let caught: unknown;
      try {
        parseParcel(fixture(file));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CatastroError);
      expect(caught).toMatchObject({ kind, code });
    });

    it('un cuerpo con un formato inesperado es "unavailable", no un éxito vacío', () => {
      expect(() => parseParcel(null)).toThrow(/formato inesperado/);
      expect(() => parseParcel('<html>')).toThrow(CatastroError);
    });
  });

  describe('catálogos', () => {
    it('provincias', () => {
      const provinces = parseProvinces(fixture('provinces.json'));
      expect(provinces).toHaveLength(48);
      expect(provinces[0]).toEqual({ code: '15', name: 'A CORUÑA' });
    });

    it('municipios (un solo resultado llega como array de 1)', () => {
      expect(parseMunicipalities(fixture('municipalities.json'))).toEqual([
        'ALCOBENDAS',
      ]);
    });

    it('callejero → sigla + nombre', () => {
      expect(parseStreets(fixture('streets.json'))).toEqual([
        { sigla: 'CL', name: 'ALCALA' },
      ]);
    });
  });
});
