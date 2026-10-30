import { areaPath, barPath, foldSlices, formatCompact, linePath, niceScale, OTHER_SLICE_KEY, ringSegment } from './chart-math';

describe('chart-math', () => {
  describe('niceScale', () => {
    it('redondea el máximo a un paso 1/2/5 y lista los ticks desde 0', () => {
      expect(niceScale(18_300)).toEqual({ max: 20_000, ticks: [0, 5000, 10_000, 15_000, 20_000] });
      expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    });

    it('sin datos devuelve una escala válida (0-1) en vez de NaN', () => {
      for (const v of [0, -5, NaN, Infinity]) expect(niceScale(v)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it('el máximo nunca queda por debajo del dato', () => {
      for (const v of [1, 99, 100, 101, 4999, 12_345.67, 0.37]) expect(niceScale(v).max).toBeGreaterThanOrEqual(v);
    });

    it('no acumula error de coma flotante en pasos decimales', () => {
      expect(niceScale(0.9).ticks).toEqual([0, 0.5, 1]);
      expect(niceScale(0.37).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    });

    it('para series de recuento (integer) el paso nunca baja de 1: sin ticks repetidos ni decimales', () => {
      expect(niceScale(1, 4, true)).toEqual({ max: 1, ticks: [0, 1] });
      expect(niceScale(2, 4, true)).toEqual({ max: 2, ticks: [0, 1, 2] });
      expect(niceScale(3, 4, true)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
      expect(niceScale(0, 4, true)).toEqual({ max: 1, ticks: [0, 1] });
      // From a step of 1 upwards the scale is the usual one.
      expect(niceScale(18_300, 4, true)).toEqual(niceScale(18_300));
      expect(niceScale(7, 4, true)).toEqual(niceScale(7));
    });
  });

  describe('formatCompact', () => {
    it('deja los números pequeños tal cual y compacta desde 1.000', () => {
      expect(formatCompact(0)).toBe('0');
      expect(formatCompact(950)).toBe('950');
      expect(formatCompact(5000)).toMatch(/^5\s?mil$/);
      expect(formatCompact(1_200_000)).toMatch(/^1,2\s?M$/);
    });
  });

  describe('barPath', () => {
    it('redondea solo el extremo de datos y deja recta la base', () => {
      const d = barPath(10, 20, 50, 100, 4);
      expect(d.startsWith('M10,100 V54')).toBe(true);
      expect(d.endsWith('V100 Z')).toBe(true);
    });

    it('limita el radio en barras muy bajas y no dibuja valores nulos', () => {
      expect(barPath(0, 20, 98, 100, 4)).toContain('V100'); // radio recortado a 2
      expect(barPath(0, 20, 100, 100)).toBe('');
      expect(barPath(0, 0, 10, 100)).toBe('');
    });
  });

  describe('ringSegment', () => {
    it('un cuarto de anillo usa arco corto; más de media vuelta, arco largo', () => {
      expect(ringSegment(50, 50, 40, 30, 0, Math.PI / 2)).toContain('0 0 1');
      expect(ringSegment(50, 50, 40, 30, 0, Math.PI * 1.5)).toContain('0 1 1');
    });

    it('un anillo completo se dibuja en dos mitades', () => {
      const d = ringSegment(50, 50, 40, 30, 0, Math.PI * 2);
      expect((d.match(/M/g) ?? []).length).toBe(2);
    });
  });

  describe('foldSlices', () => {
    const slice = (key: string, value: number) => ({ key, label: key, value });

    it('descarta valores nulos y respeta el orden si cabe', () => {
      const out = foldSlices([slice('a', 3), slice('b', 0), slice('c', 1)], 6);
      expect(out.map(s => s.key)).toEqual(['a', 'c']);
    });

    it('pliega la cola en "Otros" sumando sus valores', () => {
      const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k, i) => slice(k, 100 - i));
      const out = foldSlices(input, 6);
      expect(out).toHaveLength(6);
      expect(out[5].key).toBe(OTHER_SLICE_KEY);
      expect(out[5].value).toBe(95 + 94 + 93); // f + g + h
      expect(out.reduce((s, x) => s + x.value, 0)).toBe(input.reduce((s, x) => s + x.value, 0));
    });
  });

  describe('linePath', () => {
    it('une los puntos en orden con segmentos rectos y redondea a dos decimales', () => {
      expect(linePath([{ x: 0, y: 10 }, { x: 5.126, y: 2 }, { x: 10, y: 0 }])).toBe('M0,10 L5.13,2 L10,0');
    });

    it('sin puntos no dibuja nada', () => {
      expect(linePath([])).toBe('');
    });
  });

  describe('areaPath', () => {
    it('cierra la línea contra la base: baja por el último punto y vuelve por el primero', () => {
      expect(areaPath([{ x: 0, y: 10 }, { x: 10, y: 4 }], 20)).toBe('M0,10 L10,4 L10,20 L0,20 Z');
    });

    it('sin puntos no dibuja nada', () => {
      expect(areaPath([], 20)).toBe('');
    });
  });
});
