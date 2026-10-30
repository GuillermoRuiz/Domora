import { Component, computed, input, signal } from '@angular/core';
import { DonutSlice, OTHER_SLICE_KEY, foldSlices, ringSegment } from './chart-math';

const SIZE = 168;
const RING = 22; // anillo fino
const GAP_PX = 2; // hueco de superficie entre porciones
const MAX_SLICES = 6;

/**
 * Reparto de un total entre pocas partes (≤ 6; el resto se pliega en
 * "Otros"). Úsalo para ver "de qué se compone", no para comparar valores
 * parecidos: para eso, barras. Leyenda con porcentaje e importe, tooltip
 * también con teclado y vista de tabla equivalente.
 */
@Component({
  selector: 'app-donut-chart',
  standalone: true,
  templateUrl: './donut-chart.component.html',
  styleUrl: './chart.scss',
})
export class DonutChartComponent {
  readonly slices = input.required<DonutSlice[]>();
  readonly caption = input('Gráfico de reparto');
  /** Texto bajo la cifra central. */
  readonly totalLabel = input('Total');
  /** `false` deja el centro del anillo vacío (cifra y texto ocultos). */
  readonly showTotal = input(true);
  readonly valueFormatter = input<(value: number) => string>(v => String(v));
  readonly emptyText = input('Sin datos para este periodo');

  readonly size = SIZE;
  readonly center = SIZE / 2;
  readonly hover = signal<string | null>(null);
  readonly showTable = signal(false);

  private readonly folded = computed(() => foldSlices(this.slices(), MAX_SLICES));
  readonly total = computed(() => this.folded().reduce((sum, s) => sum + s.value, 0));
  readonly hasData = computed(() => this.total() > 0);
  readonly totalText = computed(() => this.valueFormatter()(this.total()));

  readonly items = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    const outer = SIZE / 2 - 4;
    const inner = outer - RING;
    const gap = this.folded().length > 1 ? GAP_PX / ((outer + inner) / 2) : 0;
    let angle = -Math.PI / 2;
    return this.folded().map((slice, index) => {
      const sweep = (slice.value / total) * Math.PI * 2;
      const d = ringSegment(this.center, this.center, outer, inner, angle + gap / 2, angle + sweep - gap / 2);
      angle += sweep;
      const percent = (slice.value / total) * 100;
      return {
        key: slice.key,
        label: slice.label,
        d,
        color: slice.key === OTHER_SLICE_KEY ? 'var(--color-muted)' : `var(--chart-${slice.slot ?? index + 1})`,
        amount: this.valueFormatter()(slice.value),
        percent: `${percent.toLocaleString('es-ES', { maximumFractionDigits: percent < 10 ? 1 : 0 })} %`,
      };
    }).map(item => ({ ...item, aria: `${item.label}: ${item.amount} (${item.percent})` }));
  });
}
