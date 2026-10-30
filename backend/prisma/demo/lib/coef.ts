/** Coeficientes en partes por millón: 1_000_000 ppm = 100 %. */
export const PPM_TOTAL = 1_000_000;

/**
 * Reparte `total` (entero) proporcionalmente a `weights` por el método del
 * resto mayor, con aritmética entera (BigInt) para no depender de floats.
 * Garantiza Σ resultado == total. Los pesos pueden tener hasta 3 decimales
 * (se escalan a milésimas). Desempate: mayor resto, mayor peso, menor índice.
 */
export function largestRemainder(
  weights: readonly number[],
  total: number,
): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('largestRemainder: total debe ser un entero >= 0');
  }
  if (weights.length === 0) throw new RangeError('largestRemainder: sin pesos');
  const scaled = weights.map((w) => {
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(`largestRemainder: peso inválido ${w}`);
    }
    return BigInt(Math.round(w * 1000));
  });
  const sum = scaled.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new RangeError('largestRemainder: suma de pesos es 0');

  const bigTotal = BigInt(total);
  const floors = scaled.map((w) => (w * bigTotal) / sum);
  const rems = scaled.map((w) => (w * bigTotal) % sum);
  let left = Number(bigTotal - floors.reduce((a, b) => a + b, 0n));

  const order = scaled
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = rems[a] as bigint;
      const rb = rems[b] as bigint;
      if (ra !== rb) return ra > rb ? -1 : 1;
      const wa = scaled[a] as bigint;
      const wb = scaled[b] as bigint;
      if (wa !== wb) return wa > wb ? -1 : 1;
      return a - b;
    });
  const out = floors.map(Number);
  for (let k = 0; left > 0; k++, left--) {
    out[order[k] as number] = (out[order[k] as number] as number) + 1;
  }
  return out;
}

/** Coeficientes por m² en ppm; suman EXACTAMENTE 1_000_000. */
export function coefficientsPpm(m2: readonly number[]): number[] {
  return largestRemainder(m2, PPM_TOTAL);
}

/** Cuotas en céntimos proporcionales a los coeficientes; Σ == totalCents. */
export function splitCents(
  ppm: readonly number[],
  totalCents: number,
): number[] {
  return largestRemainder(ppm, totalCents);
}

/** ppm -> porcentaje (p. ej. 12_345 -> 1.2345). */
export function ppmToPercent(ppm: number): number {
  return ppm / 10_000;
}
