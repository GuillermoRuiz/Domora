import {
  formatIban,
  ibanCheckDigits,
  isValidIban,
  makeIban,
  mod97,
  nationalCheckDigits,
  SPANISH_BANK_CODES,
} from '../lib/iban';
import {
  CIF_ORG_LETTERS,
  isValidCif,
  isValidDni,
  isValidNie,
  isValidSpanishTaxId,
  makeCif,
  makeDni,
  makeNie,
} from '../lib/nif';
import { createRng } from '../lib/rng';

describe('nif: DNI / NIE / CIF', () => {
  it('DNI conocidos', () => {
    expect(isValidDni('12345678Z')).toBe(true);
    expect(isValidDni('00000000T')).toBe(true);
    expect(isValidDni('12345678A')).toBe(false);
    expect(isValidDni('1234567Z')).toBe(false);
  });

  it('NIE conocidos', () => {
    expect(isValidNie('X1234567L')).toBe(true);
    expect(isValidNie('Y1234567X')).toBe(true);
    expect(isValidNie('Z1234567R')).toBe(true);
    expect(isValidNie('X1234567A')).toBe(false);
  });

  it('CIF conocidos (control dígito y control letra)', () => {
    expect(isValidCif('A58818501')).toBe(true); // control dígito
    expect(isValidCif('Q2826000H')).toBe(true); // Q: control letra
    expect(isValidCif('A58818502')).toBe(false);
    expect(isValidCif('Q2826000')).toBe(false);
    // Q exige letra: el dígito equivalente (D=8) no vale.
    expect(isValidCif('Q28260008')).toBe(false);
    // A exige dígito: la letra equivalente no vale.
    expect(isValidCif('A5881850A')).toBe(false);
  });

  it('isValidSpanishTaxId acepta los tres tipos y rechaza basura', () => {
    expect(isValidSpanishTaxId('12345678Z')).toBe(true);
    expect(isValidSpanishTaxId('X1234567L')).toBe(true);
    expect(isValidSpanishTaxId('A58818501')).toBe(true);
    expect(isValidSpanishTaxId('hola')).toBe(false);
  });

  it('los generadores producen identificadores válidos (propiedad)', () => {
    const rng = createRng(2026);
    for (let i = 0; i < 300; i++) {
      expect(isValidDni(makeDni(rng))).toBe(true);
      expect(isValidNie(makeNie(rng))).toBe(true);
    }
    for (const org of CIF_ORG_LETTERS) {
      for (let i = 0; i < 40; i++) {
        const cif = makeCif(rng, org);
        expect(cif).toMatch(/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/); // regex backend
        expect(isValidCif(cif)).toBe(true);
      }
    }
  });

  it('makeCif por defecto es B, comunidades H, y rechaza letras no admitidas', () => {
    const rng = createRng(1);
    expect(makeCif(rng)).toMatch(/^B/);
    expect(makeCif(rng, 'H')).toMatch(/^H/);
    expect(() => makeCif(rng, 'X')).toThrow(RangeError);
  });

  it('es determinista con la misma semilla', () => {
    expect(makeDni(createRng(5))).toBe(makeDni(createRng(5)));
    expect(makeCif(createRng(5), 'H')).toBe(makeCif(createRng(5), 'H'));
  });
});

describe('iban: ES con control nacional + mod 97', () => {
  const KNOWN = ['ES9121000418450200051332', 'ES7620770024003102575766'];

  it('IBAN españoles de prueba conocidos son válidos', () => {
    for (const iban of KNOWN) expect(isValidIban(iban)).toBe(true);
    expect(isValidIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
  });

  it('detecta errores: mod97, control nacional, formato y país', () => {
    expect(isValidIban('ES9221000418450200051332')).toBe(false); // mod97
    expect(isValidIban('ES9121000418460200051332')).toBe(false); // DC nacional/mod97
    expect(isValidIban('ES91210004184502000513')).toBe(false); // longitud
    expect(isValidIban('FR1420041010050500013M02606')).toBe(false); // país
  });

  it('el control nacional del vector conocido es 45', () => {
    expect(nationalCheckDigits('2100', '0418', '0200051332')).toBe('45');
    expect(ibanCheckDigits('21000418450200051332')).toBe('91');
  });

  it('mod97 iterativo coincide con BigInt', () => {
    for (const s of ['21000418450200051332142891', '98765432109876543210123']) {
      expect(mod97(s)).toBe(Number(BigInt(s) % 97n));
    }
  });

  it('makeIban genera IBAN válidos para todas las entidades (propiedad)', () => {
    const rng = createRng(2026);
    for (const bank of SPANISH_BANK_CODES) {
      for (let i = 0; i < 50; i++) {
        const iban = makeIban(rng, bank);
        expect(iban).toMatch(/^ES\d{22}$/);
        expect(iban.slice(4, 8)).toBe(bank);
        expect(isValidIban(iban)).toBe(true);
      }
    }
    for (let i = 0; i < 100; i++) expect(isValidIban(makeIban(rng))).toBe(true);
  });

  it('formato espaciado y determinismo', () => {
    const spaced = makeIban(createRng(8), '2100', 'spaced');
    expect(spaced).toMatch(/^ES\d{2}( \d{4}){5}$/);
    expect(isValidIban(spaced)).toBe(true);
    expect(makeIban(createRng(8))).toBe(makeIban(createRng(8)));
    expect(formatIban('ES9121000418450200051332')).toBe(
      'ES91 2100 0418 4502 0005 1332',
    );
    expect(() => makeIban(createRng(1), '21')).toThrow(RangeError);
  });
});
