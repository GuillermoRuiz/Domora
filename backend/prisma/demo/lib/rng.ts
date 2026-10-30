/**
 * PRNG determinista (mulberry32). Misma semilla = misma secuencia, en
 * cualquier máquina. Nunca usa Math.random().
 */
export const DEMO_SEED = 2026;

export interface Rng {
  /** Float uniforme en [0, 1). */
  (): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number = DEMO_SEED): Rng {
  return mulberry32(seed);
}

/** Entero uniforme en [min, max] (ambos incluidos). */
export function randInt(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`randInt: rango inválido [${min}, ${max}]`);
  }
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: lista vacía');
  return items[Math.floor(rng() * items.length)] as T;
}

/** Fisher-Yates sobre una copia (no muta la entrada). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** String de `length` dígitos decimales. */
export function randDigits(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String(Math.floor(rng() * 10));
  return s;
}
