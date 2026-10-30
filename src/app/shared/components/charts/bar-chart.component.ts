import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { barPath, formatCompact, niceScale } from './chart-math';

export interface BarSeries {
  key: string;
  label: string;
  values: number[];
  /** Hueco de la paleta categórica (1..6). Por defecto, su posición: el color sigue a la entidad. */
  slot?: number;
}

const MARGIN = { top: 10, right: 8, bottom: 30, left: 46 };
const MAX_BAR = 24; // barras finas: nunca llenan su hueco
const MIN_LABEL_SLOT = 36; // ancho mínimo por etiqueta del eje X
const BAR_GAP = 2; // separación entre barras contiguas (aire, no borde)

/**
 * Barras agrupadas por categoría (p. ej. ingresos y gastos por mes). SVG
 * propio, sin dependencias: ejes con escala redonda, cuadrícula hairline,
 * extremo redondeado de 4 px con base recta, leyenda, tooltip con el valor
 * al frente (también con teclado) y vista de tabla equivalente.
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  templateUrl: './bar-chart.component.html',
  styleUrl: './chart.scss',
})
export class BarChartComponent {
  readonly categories = input.required<string[]>();
  readonly series = input.required<BarSeries[]>();
  /** Resumen accesible del gráfico (también es el título de la tabla). */
  readonly caption = input('Gráfico de barras');
  readonly height = input(250);
  readonly valueFormatter = input<(value: number) => string>(v => String(v));
  readonly emptyText = input('Sin datos para este periodo');
  /** Count series: whole-number Y ticks only (no «0 · 1 · 1» when the maximum is 1). */
  readonly integerTicks = input(false);

  readonly plotLeft = MARGIN.left;
  readonly width = signal(560);
  readonly hover = signal<number | null>(null);
  readonly showTable = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(entries => {
        const w = Math.floor(entries[0].contentRect.width);
        if (w > 0) this.width.set(Math.max(260, w));
      });
      observer.observe(this.host);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  readonly hasData = computed(() => this.series().some(s => s.values.some(v => v > 0)));

  private readonly plot = computed(() => ({
    left: MARGIN.left,
    right: this.width() - MARGIN.right,
    top: MARGIN.top,
    bottom: this.height() - MARGIN.bottom,
  }));

  private readonly scale = computed(() => niceScale(Math.max(0, ...this.series().flatMap(s => s.values)), 4, this.integerTicks()));

  readonly ticks = computed(() => {
    const { top, bottom } = this.plot();
    const { max, ticks } = this.scale();
    return ticks.map(value => ({ value, label: formatCompact(value), y: bottom - (value / max) * (bottom - top) }));
  });

  readonly groups = computed(() => {
    const { left, right, top, bottom } = this.plot();
    const { max } = this.scale();
    const categories = this.categories();
    const series = this.series();
    const slotWidth = (right - left) / Math.max(1, categories.length);
    const barWidth = Math.max(2, Math.min(MAX_BAR, (slotWidth * 0.7 - BAR_GAP * (series.length - 1)) / Math.max(1, series.length)));
    // Etiquetas del eje X: si no caben todas (móvil), se salta alguna; el tooltip y la tabla las conservan.
    const labelStep = Math.max(1, Math.ceil(MIN_LABEL_SLOT / slotWidth));
    const groupWidth = barWidth * series.length + BAR_GAP * (series.length - 1);
    return categories.map((label, index) => {
      const cx = left + slotWidth * index + slotWidth / 2;
      const start = cx - groupWidth / 2;
      return {
        index,
        label,
        showLabel: index % labelStep === 0,
        cx,
        slotX: left + slotWidth * index,
        slotWidth,
        bars: series.map((s, i) => {
          const value = s.values[index] ?? 0;
          const yTop = bottom - (value / max) * (bottom - top);
          return { key: s.key, d: barPath(start + i * (barWidth + BAR_GAP), barWidth, yTop, bottom), color: this.color(s, i) };
        }),
        aria: `${label}: ${series.map(s => `${s.label} ${this.valueFormatter()(s.values[index] ?? 0)}`).join(', ')}`,
      };
    });
  });

  readonly legend = computed(() => this.series().map((s, i) => ({ key: s.key, label: s.label, color: this.color(s, i) })));

  readonly tooltip = computed(() => {
    const index = this.hover();
    if (index === null) return null;
    const group = this.groups()[index];
    if (!group) return null;
    return {
      label: group.label,
      left: Math.min(Math.max(group.cx, 84), this.width() - 84),
      rows: this.series().map((s, i) => ({ key: s.key, label: s.label, color: this.color(s, i), value: this.valueFormatter()(s.values[index] ?? 0) })),
    };
  });

  readonly tableRows = computed(() => this.categories().map((label, index) => ({
    label,
    cells: this.series().map(s => this.valueFormatter()(s.values[index] ?? 0)),
  })));

  private color(series: BarSeries, index: number): string {
    return `var(--chart-${series.slot ?? index + 1})`;
  }
}
