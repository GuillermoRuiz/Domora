import { presetsFor, suggestMapping } from './gesfincas-net.presets';

describe('presetsFor', () => {
  it('el perfil GESFINCAS_NET trae cabeceras-guess', () => {
    const fields = presetsFor('GESFINCAS_NET', 'property');
    expect(
      fields.find((f) => f.targetField === 'participationQuota')?.headerGuesses
        .length,
    ).toBeGreaterThan(0);
  });

  it('el perfil GENERIC tiene los mismos campos pero SIN cabeceras-guess (mapeo 100% manual)', () => {
    const fields = presetsFor('GENERIC', 'property');
    expect(fields.every((f) => f.headerGuesses.length === 0)).toBe(true);
    expect(fields.map((f) => f.targetField)).toEqual(
      presetsFor('GESFINCAS_NET', 'property').map((f) => f.targetField),
    );
  });
});

describe('suggestMapping', () => {
  it('empareja cabeceras reales contra los guesses, sin distinguir mayúsculas ni acentos', () => {
    const fields = presetsFor('GESFINCAS_NET', 'property');
    const headers = [
      'Nº Finca',
      'COEFICIENTE',
      'planta',
      'Puerta',
      'Otra columna sin relación',
    ];
    const mapping = suggestMapping(headers, fields);

    expect(mapping['ref']).toBe('Nº Finca');
    expect(mapping['participationQuota']).toBe('COEFICIENTE');
    expect(mapping['door']).toBe('Puerta');
  });

  it('no sugiere nada para un campo cuya cabecera no aparece en el fichero', () => {
    const fields = presetsFor('GESFINCAS_NET', 'property');
    const mapping = suggestMapping(['Columna sin relación'], fields);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('con el perfil GENERIC nunca sugiere nada (sin guesses que emparejar)', () => {
    const fields = presetsFor('GENERIC', 'property');
    const mapping = suggestMapping(['Nº Finca', 'Coeficiente'], fields);
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});
