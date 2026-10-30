import {
  coefficientsPpm,
  largestRemainder,
  PPM_TOTAL,
  ppmToPercent,
  splitCents,
} from '../lib/coef';
import { makePdf } from '../lib/pdf';
import { createRng, randInt } from '../lib/rng';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('coef: resto mayor', () => {
  it('reparto clásico 1/3 cada uno: 333_334 + 333_333 + 333_333', () => {
    const r = coefficientsPpm([1, 1, 1]);
    expect(sum(r)).toBe(PPM_TOTAL);
    expect([...r].sort()).toEqual([333_333, 333_333, 333_334]);
    // desempate por menor índice
    expect(r).toEqual([333_334, 333_333, 333_333]);
  });

  it('suma EXACTAMENTE 1_000_000 con m² reales irregulares', () => {
    const m2 = [62.5, 71, 85.25, 90, 58.75, 110, 47.3, 66.6, 120.4];
    const r = coefficientsPpm(m2);
    expect(sum(r)).toBe(1_000_000);
    expect(r.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    // proporcionalidad: el mayor m² tiene el mayor coeficiente
    expect(r.indexOf(Math.max(...r))).toBe(m2.indexOf(Math.max(...m2)));
  });

  it('propiedad: 200 repartos aleatorios suman exacto (hasta 61 unidades)', () => {
    const rng = createRng(2026);
    for (let i = 0; i < 200; i++) {
      const n = randInt(rng, 1, 61);
      const m2 = Array.from({ length: n }, () => randInt(rng, 25, 4000) / 10);
      const r = coefficientsPpm(m2);
      expect(r).toHaveLength(n);
      expect(sum(r)).toBe(PPM_TOTAL);
    }
  });

  it('cada resultado difiere a lo sumo 1 ppm de su proporción exacta', () => {
    const m2 = [33.3, 47.1, 52.9, 100.2, 75.5];
    const exact = m2.map((w) => (w / sum(m2)) * PPM_TOTAL);
    coefficientsPpm(m2).forEach((v, i) =>
      expect(Math.abs(v - (exact[i] as number))).toBeLessThan(1.0001),
    );
  });

  it('splitCents: cuotas mensuales suman el presupuesto al céntimo', () => {
    const ppm = coefficientsPpm([62.5, 71, 85.25, 90, 58.75]);
    for (const total of [1, 99_999, 1_234_567, 5_000_001]) {
      expect(sum(splitCents(ppm, total))).toBe(total);
    }
  });

  it('valida entradas', () => {
    expect(() => largestRemainder([], 10)).toThrow(RangeError);
    expect(() => largestRemainder([0, 0], 10)).toThrow(RangeError);
    expect(() => largestRemainder([1, -1], 10)).toThrow(RangeError);
    expect(() => largestRemainder([1, 1], 1.5)).toThrow(RangeError);
    expect(largestRemainder([5], 7)).toEqual([7]);
  });

  it('ppmToPercent', () => {
    expect(ppmToPercent(1_000_000)).toBe(100);
    expect(ppmToPercent(12_345)).toBe(1.2345);
  });
});

describe('pdf (pdfkit)', () => {
  const when = new Date('2026-10-11T00:00:00.000Z');
  const input = {
    title: 'Convocatoria de Junta General',
    subtitle: 'Comunidad de Propietarios Colón 12',
    lines: ['Orden del día', '1. Aprobación de cuentas', '2. Presupuesto'],
    tables: [
      {
        headers: ['Piso', 'Coef.', 'Cuota'],
        rows: [
          ['1A', '2,5000', '41,67'],
          ['1B', '3,1000', '51,67'],
        ],
      },
    ],
    creationDate: when,
  };

  it('genera un buffer no vacío que empieza por %PDF y acaba en %%EOF', async () => {
    const buf = await makePdf(input);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buf.subarray(-8).toString('latin1')).toContain('%%EOF');
  });

  it('es determinista: misma entrada = mismos bytes', async () => {
    const [a, b] = await Promise.all([makePdf(input), makePdf(input)]);
    expect(a.equals(b)).toBe(true);
  });

  it('una entrada distinta produce bytes distintos', async () => {
    const a = await makePdf(input);
    const b = await makePdf({ ...input, title: 'Acta de Junta General' });
    expect(a.equals(b)).toBe(false);
  });

  it('sin líneas ni tablas también genera un PDF válido', async () => {
    const buf = await makePdf({ title: 'Solo título', creationDate: when });
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
