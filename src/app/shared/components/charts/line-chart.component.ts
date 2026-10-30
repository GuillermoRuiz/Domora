import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { areaPath, formatCompact, linePath, niceScale } from './chart-math';

const MARGIN = { top: 10, right: 8, bottom: 30, left: 46 };
const MIN_LABEL_SLOT = 36; // minimum width per X-axis label

/**
 * One series over time (e.g. monthly MRR) as a 2 px line, optionally with a
 * soft area under it. Same anatomy as `app-bar-chart`: zero-based round
 * scale, hairline grid, crosshair + tooltip on pointer and keyboard focus,
 * and an equivalent table view. Single series: no legend, the card title names it.
 */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  templateUrl: './line-chart.component.html',
  styleUrl: './chart.scss',
})
export class LineChartComponent {
  readonly categories = input.required<string[]>();
  readonly values = input.required<number[]>();
  /** Series name: table column header and tooltip label. */
  readonly label = input('Valor');
  readonly area = input(false);
  /** Accessible summary of the chart (also the table caption). */
  readonly caption = input('Gráfico de líneas');
  readonly height = input(250);
  readonly valueFormatter = input<(value: number) => string>(v => String(v));
  readonly emptyText = input('Sin datos para este periodo');
  /** Categorical palette slot (1..6): the colour follows the series. */
  readonly slot = input(1);

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

  readonly color = computed(() => `var(--chart-${this.slot()})`);
  readonly hasData = computed(() => this.values().some(v => v !== 0));

  private readonly plot = computed(() => ({
    left: MARGIN.left,
    right: this.width() - MARGIN.right,
    top: MARGIN.top,
    bottom: this.height() - MARGIN.bottom,
  }));

  private readonly scale = computed(() => niceScale(Math.max(0, ...this.values())));

  readonly bottom = computed(() => this.plot().bottom);

  readonly ticks = computed(() => {
    const { top, bottom } = this.plot();
    const { max, ticks } = this.scale();
    return ticks.map(value => ({ value, label: formatCompact(value), y: bottom - (value / max) * (bottom - top) }));
  });

  readonly points = computed(() => {
    const { left, right, top, bottom } = this.plot();
    const { max } = this.scale();
    const categories = this.categories();
    const slotWidth = (right - left) / Math.max(1, categories.length);
    // X-axis labels: skip some when they do not fit (phone); tooltip and table keep them all.
    const labelStep = Math.max(1, Math.ceil(MIN_LABEL_SLOT / slotWidth));
    return categories.map((label, index) => {
      const value = this.values()[index] ?? 0;
      return {
        index,
        label,
        showLabel: index % labelStep === 0,
        x: left + slotWidth * index + slotWidth / 2,
        y: bottom - (Math.max(0, value) / max) * (bottom - top),
        slotX: left + slotWidth * index,
        slotWidth,
        aria: `${label}: ${this.valueFormatter()(value)}`,
      };
    });
  });

  readonly line = computed(() => linePath(this.points()));
  readonly fill = computed(() => (this.area() ? areaPath(this.points(), this.plot().bottom) : ''));

  readonly tooltip = computed(() => {
    const index = this.hover();
    if (index === null) return null;
    const point = this.points()[index];
    if (!point) return null;
    return {
      point,
      left: Math.min(Math.max(point.x, 84), this.width() - 84),
      value: this.valueFormatter()(this.values()[index] ?? 0),
    };
  });

  readonly tableRows = computed(() => this.categories().map((label, index) => ({
    label,
    value: this.valueFormatter()(this.values()[index] ?? 0),
  })));
}
