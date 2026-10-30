import { INSTALLATION_TYPES, INSTALLATION_TYPE_OPTIONS, installationTypeFor } from './installation-types';

describe('installationTypeFor', () => {
  it('reconoce el texto exacto de cada tipo del catálogo, sin importar tildes ni mayúsculas', () => {
    for (const type of INSTALLATION_TYPES) expect(installationTypeFor(type.label).key).toBe(type.key);
    expect(installationTypeFor('CALEFACCION / acs').key).toBe('calefaccion');
  });

  it('reconoce textos libres por sus palabras clave', () => {
    expect(installationTypeFor('Ascensores').key).toBe('ascensor');
    expect(installationTypeFor('Extintores portátiles').key).toBe('pci');
    expect(installationTypeFor('Cámaras CCTV').key).toBe('videovigilancia');
    expect(installationTypeFor('Grupo electrógeno').key).toBe('electricidad');
    expect(installationTypeFor('Tejado').key).toBe('cubierta');
    expect(installationTypeFor('Cimentación').key).toBe('estructura');
  });

  it('no confunde una palabra que solo contiene la clave (palabra completa)', () => {
    expect(installationTypeFor('Gasolinera').key).toBe('otro'); // contiene "gas" pero no es "gas"
    expect(installationTypeFor('Cuadra').key).toBe('otro');
  });

  it('un texto desconocido, vacío o nulo cae en "Otro"', () => {
    for (const text of ['Algo raro', '', '   ', null, undefined]) expect(installationTypeFor(text).key).toBe('otro');
  });

  it('el catálogo no repite claves ni etiquetas y "Otro" va el último', () => {
    const keys = INSTALLATION_TYPES.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(INSTALLATION_TYPES.map(t => t.label)).size).toBe(keys.length);
    expect(keys[keys.length - 1]).toBe('otro');
    expect(INSTALLATION_TYPE_OPTIONS.map(o => o.key)).toEqual(keys);
  });

  it('cada tipo tiene un icono y los alias no se pisan entre tipos', () => {
    expect(INSTALLATION_TYPES.every(t => t.icon.length > 0)).toBe(true);
    const seen = new Map<string, string>();
    for (const type of INSTALLATION_TYPES) {
      for (const alias of type.aliases) {
        expect(seen.get(alias), `alias "${alias}" repetido`).toBeUndefined();
        seen.set(alias, type.key);
      }
    }
  });
});
