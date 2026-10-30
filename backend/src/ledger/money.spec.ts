import { fromCents, percentOf, splitByWeights, toCents } from './money';

describe('money — céntimos', () => {
  it('convierte euros a céntimos y vuelta sin perder precisión', () => {
    expect(toCents('87.50')).toBe(8750);
    expect(toCents(0.1)).toBe(10);
    expect(toCents('1234567.89')).toBe(123456789);
    expect(fromCents(8750).toFixed(2)).toBe('87.50');
    expect(fromCents(-1).toFixed(2)).toBe('-0.01');
  });

  it('rechaza importes con más de dos decimales en lugar de redondear en silencio', () => {
    expect(() => toCents('10.005')).toThrow(/más de dos decimales/);
  });

  it('percentOf redondea medio céntimo hacia arriba', () => {
    // 10 % de 0,05 € = 0,005 € → 0,01 €
    expect(percentOf(5, 10)).toBe(1);
    // 9,0909 % de 33,33 € = 3,0299… € → 3,03 €
    expect(percentOf(3333, '9.0909')).toBe(303);
    expect(percentOf(10000, 0)).toBe(0);
  });
});

describe('money — splitByWeights (mayor resto)', () => {
  it('la suma de las partes es siempre el total', () => {
    const cases: [number, number[]][] = [
      [10000, [1, 1, 1]],
      [1, [1, 1, 1]],
      [9999, [33.33, 33.33, 33.34]],
      [123457, [5.5, 12.25, 30, 52.25]],
      [0, [1, 2]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitByWeights(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every(Number.isInteger)).toBe(true);
    }
  });

  it('100 € entre tres partes iguales: el céntimo sobrante va a la primera', () => {
    expect(splitByWeights(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it('el céntimo sobrante va a la mayor fracción, no a la primera', () => {
    // 1 € repartido 20/30/50 → 20, 30, 50 exactos
    expect(splitByWeights(100, [20, 30, 50])).toEqual([20, 30, 50]);
    // 0,10 € en pesos 1/2 → 3,33 y 6,67 → 3 y 7
    expect(splitByWeights(10, [1, 2])).toEqual([3, 7]);
  });

  it('reparte importes negativos con el mismo criterio', () => {
    const parts = splitByWeights(-10000, [1, 1, 1]);
    expect(parts).toEqual([-3334, -3333, -3333]);
  });

  it('pesos vacíos, negativos o que suman cero son un error', () => {
    expect(() => splitByWeights(100, [])).toThrow();
    expect(() => splitByWeights(100, [1, -1])).toThrow();
    expect(() => splitByWeights(100, [0, 0])).toThrow();
  });
});
