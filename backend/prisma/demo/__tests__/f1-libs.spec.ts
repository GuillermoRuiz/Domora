import { FIRST_NAMES_FEMALE, FIRST_NAMES_MALE, SURNAMES } from '../data/names';
import { buildUnits, ESTATE_SPECS } from '../data/estates';
import { DEMO_EMAIL_DOMAIN } from '../guard';
import {
  isValidParcelReference,
  isValidUnitReference,
  makeParcelReference,
  makeUnitReference,
} from '../lib/catastro';
import { isValidCreditorId, makeCreditorId } from '../lib/creditor-id';
import { PersonFactory, slugify } from '../lib/names';
import { isValidSpanishTaxId, makeCif } from '../lib/nif';
import { createRng } from '../lib/rng';

describe('data/names', () => {
  it.each([
    ['nombres masculinos', FIRST_NAMES_MALE],
    ['nombres femeninos', FIRST_NAMES_FEMALE],
    ['apellidos', SURNAMES],
  ])('%s: sin duplicados', (_label, list) => {
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('lib/names PersonFactory', () => {
  it('genera personas únicas (nombre, email y NIF) con email @demo.domora.app', () => {
    const factory = new PersonFactory(createRng(2026));
    const persons = Array.from({ length: 120 }, (_, i) =>
      factory.next({ foreign: i % 9 === 4 }),
    );
    expect(new Set(persons.map((p) => p.fullName)).size).toBe(120);
    expect(new Set(persons.map((p) => p.email)).size).toBe(120);
    expect(new Set(persons.map((p) => p.taxId)).size).toBe(120);
    for (const p of persons) {
      expect(p.email.endsWith(DEMO_EMAIL_DOMAIN)).toBe(true);
      expect(p.email).toMatch(/^[a-z0-9.]+@/);
      expect(isValidSpanishTaxId(p.taxId)).toBe(true);
      expect(p.phone).toMatch(/^[67]\d\d \d\d \d\d \d\d$/);
      expect(p.fullName).not.toMatch(/test|lorem|usuario|falsa/i);
    }
    expect(persons.some((p) => /^[XYZ]/.test(p.taxId))).toBe(true);
  });

  it('es determinista: misma semilla = mismas personas', () => {
    const a = new PersonFactory(createRng(2026));
    const b = new PersonFactory(createRng(2026));
    expect(Array.from({ length: 20 }, () => a.next().email)).toEqual(
      Array.from({ length: 20 }, () => b.next().email),
    );
  });

  it('no reutiliza emails reservados (propietario@, moroso@...)', () => {
    const factory = new PersonFactory(createRng(1));
    factory.reserveEmail(`laura.garcia${DEMO_EMAIL_DOMAIN}`);
    for (let i = 0; i < 300; i++) {
      expect(factory.next().email).not.toBe(`laura.garcia${DEMO_EMAIL_DOMAIN}`);
    }
  });

  it('slugify quita acentos y símbolos', () => {
    expect(slugify('Ángel Núñez-Peña')).toBe('angelnunezpena');
  });
});

describe('lib/catastro', () => {
  it('parcela de 14 y unidad de 20 caracteres con formato válido', () => {
    const rng = createRng(7);
    const parcel = makeParcelReference(rng);
    expect(parcel).toHaveLength(14);
    expect(isValidParcelReference(parcel)).toBe(true);
    const unit = makeUnitReference(rng, parcel, 12);
    expect(unit).toHaveLength(20);
    expect(unit.startsWith(parcel)).toBe(true);
    expect(isValidUnitReference(unit)).toBe(true);
    expect(isValidUnitReference('XXXX')).toBe(false);
  });
});

describe('lib/creditor-id', () => {
  it('genera creditorId válidos (16 caracteres, mod-97) a partir del CIF', () => {
    const rng = createRng(11);
    for (let i = 0; i < 50; i++) {
      const cif = makeCif(rng, 'H');
      const cid = makeCreditorId(cif);
      expect(cid).toHaveLength(16);
      expect(cid.startsWith('ES')).toBe(true);
      expect(cid.endsWith(cif)).toBe(true);
      expect(isValidCreditorId(cid)).toBe(true);
    }
  });

  it('detecta un creditorId manipulado', () => {
    const cid = makeCreditorId('H12345674');
    expect(isValidCreditorId(cid)).toBe(true);
    const bad = `${cid.slice(0, 2)}${cid.slice(2, 4) === '00' ? '01' : '00'}${cid.slice(4)}`;
    expect(isValidCreditorId(bad)).toBe(false);
    expect(() => makeCreditorId('1234')).toThrow(RangeError);
  });
});

describe('data/estates', () => {
  it('3 fincas de 40/15/6 = 61 unidades con refs únicas y m2 > 0', () => {
    const counts = ESTATE_SPECS.map((spec) => {
      const units = buildUnits(spec, createRng(2026));
      expect(new Set(units.map((u) => u.ref)).size).toBe(units.length);
      for (const u of units) expect(u.m2).toBeGreaterThan(0);
      return units.length;
    });
    expect(counts).toEqual([40, 15, 6]);
  });

  it('Colón 24 = 28 viviendas + 8 garajes + 4 locales', () => {
    const units = buildUnits(ESTATE_SPECS[0]!, createRng(2026));
    const by = (k: string) => units.filter((u) => u.kind === k).length;
    expect([by('Piso'), by('Parking'), by('Local')]).toEqual([28, 8, 4]);
  });
});
