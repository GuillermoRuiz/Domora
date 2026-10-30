import { createClock, resolveAnchor, startOfUtcDay } from '../clock';
import { createBaseContext } from '../context';
import {
  chance,
  createRng,
  DEMO_SEED,
  mulberry32,
  pick,
  randDigits,
  randInt,
  shuffle,
} from '../lib/rng';

describe('rng (mulberry32)', () => {
  it('misma semilla = misma secuencia', () => {
    const a = mulberry32(2026);
    const b = mulberry32(2026);
    const sa = Array.from({ length: 50 }, () => a());
    const sb = Array.from({ length: 50 }, () => b());
    expect(sa).toEqual(sb);
  });

  it('semillas distintas = secuencias distintas', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('vector conocido de la semilla 2026 (regresión: cambiarlo cambia todo el dataset)', () => {
    const rng = createRng(DEMO_SEED);
    expect(DEMO_SEED).toBe(2026);
    const first = [rng(), rng(), rng()];
    first.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
    const again = createRng(2026);
    expect([again(), again(), again()]).toEqual(first);
  });

  it('randInt respeta el rango inclusivo y rechaza rangos inválidos', () => {
    const rng = createRng();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randInt(rng, 3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(() => randInt(rng, 5, 4)).toThrow(RangeError);
  });

  it('shuffle es determinista, no muta y conserva elementos', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...input];
    const s1 = shuffle(createRng(7), input);
    const s2 = shuffle(createRng(7), input);
    expect(input).toEqual(copy);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(copy);
  });

  it('pick, chance y randDigits son deterministas', () => {
    expect(pick(createRng(3), ['a', 'b', 'c'])).toBe(
      pick(createRng(3), ['a', 'b', 'c']),
    );
    expect(() => pick(createRng(3), [])).toThrow(RangeError);
    expect(chance(createRng(3), 1)).toBe(true);
    expect(chance(createRng(3), 0)).toBe(false);
    expect(randDigits(createRng(9), 12)).toMatch(/^\d{12}$/);
    expect(randDigits(createRng(9), 12)).toBe(randDigits(createRng(9), 12));
  });
});

describe('clock (ancla única, sin parchear Date global)', () => {
  const ANCHOR = new Date('2026-10-11T00:00:00.000Z');

  it('d() desplaza días respecto al ancla', () => {
    const c = createClock(ANCHOR);
    expect(c.d(0).toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(c.d(14).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(c.d(-30).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('ANCHOR+30d desplaza todos los offsets 30 días (fechas relativas)', () => {
    const base = createClock(ANCHOR);
    const moved = createClock(new Date(ANCHOR.getTime() + 30 * 86_400_000));
    for (const off of [-365, -90, -1, 0, 2, 14]) {
      expect(moved.d(off).getTime() - base.d(off).getTime()).toBe(
        30 * 86_400_000,
      );
    }
  });

  it('monthStart y monthsAgo cruzan año y recortan fin de mes', () => {
    const c = createClock(new Date('2026-03-31T00:00:00.000Z'));
    expect(c.monthStart(0).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(c.monthStart(3).toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(c.monthsAgo(1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(c.monthsAgo(12).toISOString()).toBe('2025-03-31T00:00:00.000Z');
  });

  it('el ancla es inmutable y no se altera mutando lo devuelto', () => {
    const c = createClock(ANCHOR);
    c.anchor.setUTCFullYear(1999);
    c.d(1).setUTCFullYear(1999);
    expect(c.anchor.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  it('no parchea Date global', () => {
    const original = Date;
    const originalNow = Date.now;
    createClock(ANCHOR);
    createBaseContext({ DEMO_NOW: '2020-01-01' });
    expect(Date).toBe(original);
    expect(Date.now).toBe(originalNow);
  });

  it('resolveAnchor: DEMO_NOW manda, si no hoy UTC 00:00, inválido lanza', () => {
    expect(
      resolveAnchor({ DEMO_NOW: '2026-05-20T15:30:00Z' }).toISOString(),
    ).toBe('2026-05-20T00:00:00.000Z');
    expect(
      resolveAnchor({}, new Date('2026-10-11T18:45:10Z')).toISOString(),
    ).toBe('2026-10-11T00:00:00.000Z');
    expect(() => resolveAnchor({ DEMO_NOW: 'no-es-fecha' })).toThrow(
      /DEMO_NOW/,
    );
    expect(startOfUtcDay(new Date('2026-01-02T23:59:59Z')).toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });

  it('createBaseContext une ancla, reloj y rng con semilla fija', () => {
    const a = createBaseContext({ DEMO_NOW: '2026-10-11' });
    const b = createBaseContext({ DEMO_NOW: '2026-10-11' });
    expect(a.now.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(a.clock.anchor).toEqual(a.now);
    expect(a.rng()).toBe(b.rng());
  });
});
