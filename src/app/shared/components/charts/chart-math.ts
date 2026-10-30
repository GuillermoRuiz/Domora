export interface NiceScale {
  max: number;
  ticks: number[];
}

/**
 * Escala "redonda" (pasos 1, 2, 5 × 10ⁿ) que contiene el máximo, con 0 como base.
 * `integer` (series de recuento): el paso nunca baja de 1, así no hay ticks
 * decimales que se redondean al mismo número (p. ej. «0 · 1 · 1» con máximo 1).
 */
export function niceScale(rawMax: number, targetTicks = 4, integer = false): NiceScale {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return { max: 1, ticks: [0, 1] };
  const rough = rawMax / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const step = integer ? Math.max(1, niceStep) : niceStep;
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= max + step / 1000; i++) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { max, ticks };
}

/** 0 · 500 · 1 mil · 12,5 mil · 1,2 M: etiquetas de eje compactas a partir de 1.000. */
export function formatCompact(value: number, locale = 'es-ES'): string {
  if (Math.abs(value) < 1000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Barra con el extremo de datos redondeado (r px) y la base recta, anclada a `yBase`. */
export function barPath(x: number, width: number, yTop: number, yBase: number, radius = 4): string {
  const height = yBase - yTop;
  if (!(height > 0) || !(width > 0)) return '';
  const r = Math.min(radius, height, width / 2);
  return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + width - r} Q${x + width},${yTop} ${x + width},${yTop + r} V${yBase} Z`;
}

export interface ChartPoint {
  x: number;
  y: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Polyline through the points in order (2-decimal coordinates); empty when there are none. */
export function linePath(points: ChartPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r2(p.x)},${r2(p.y)}`).join(' ');
}

/** The line closed against `yBase` (down the last point, back along the base): the fill of an area chart. */
export function areaPath(points: ChartPoint[], yBase: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${r2(last.x)},${r2(yBase)} L${r2(first.x)},${r2(yBase)} Z`;
}

function polar(cx: number, cy: number, r: number, angle: number): string {
  return `${(cx + r * Math.cos(angle)).toFixed(3)},${(cy + r * Math.sin(angle)).toFixed(3)}`;
}

/** Sector de anillo entre dos ángulos (radianes, sentido horario, 0 = derecha). */
export function ringSegment(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (sweep >= Math.PI * 2 - 1e-6) {
    // Anillo completo: dos medios anillos (un arco de 360° no se puede dibujar).
    const mid = a0 + Math.PI;
    return `${ringSegment(cx, cy, outer, inner, a0, mid)} ${ringSegment(cx, cy, outer, inner, mid, a0 + Math.PI * 2 - 1e-4)}`;
  }
  const large = sweep > Math.PI ? 1 : 0;
  return `M${polar(cx, cy, outer, a0)} A${outer},${outer} 0 ${large} 1 ${polar(cx, cy, outer, a1)} `
    + `L${polar(cx, cy, inner, a1)} A${inner},${inner} 0 ${large} 0 ${polar(cx, cy, inner, a0)} Z`;
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Hueco de la paleta categórica (1..6). Por defecto, su posición: el color sigue a la entidad, no al ranking. */
  slot?: number;
}

export const OTHER_SLICE_KEY = '__folded-other__';

/**
 * Deja como mucho `max` porciones: las que sobran (las de menor valor, al
 * final de la lista ordenada) se pliegan en "Otros" en vez de inventar
 * más tonos.
 */
export function foldSlices(slices: DonutSlice[], max = 6, otherLabel = 'Otros'): DonutSlice[] {
  const positive = slices.filter(s => s.value > 0);
  if (positive.length <= max) return positive;
  const ordered = [...positive].sort((a, b) => b.value - a.value);
  const kept = ordered.slice(0, max - 1);
  const rest = ordered.slice(max - 1).reduce((sum, s) => sum + s.value, 0);
  return [...kept, { key: OTHER_SLICE_KEY, label: otherLabel, value: rest }];
}
