import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { EstateExpenseBreakdown, ExpenseCategoryKey } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { DonutChartComponent } from '../../../shared/components/charts/donut-chart.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

/** Hueco fijo de la paleta por categoría: el color sigue a la categoría, no a su posición en el ranking. */
const SLOT: Record<ExpenseCategoryKey, number> = {
  maintenance: 1, supplies: 2, staff: 3, insurance: 4, services: 5, other: 6,
};
// `useGrouping: 'always'`: como el pipe `currency` de la app, agrupa miles también en 4 cifras.
const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

/**
 * "Distribución de gastos" del ejercicio elegido en la tarjeta de ingresos y
 * gastos (llega como `year`): así las dos gráficas hablan siempre del mismo año.
 */
@Component({
  selector: 'app-expense-breakdown-card',
  standalone: true,
  imports: [SectionCardComponent, DonutChartComponent],
  templateUrl: './expense-breakdown-card.component.html',
  styleUrl: './expense-breakdown-card.component.scss',
})
export class ExpenseBreakdownCardComponent implements OnChanges {
  @Input({ required: true }) estateId!: string;
  /** Ejercicio a mostrar; `null` mientras la tarjeta de ingresos y gastos aún no lo ha fijado. */
  @Input() year: number | null = null;

  private dashboard = inject(EstateDashboardService);

  readonly data = signal<EstateExpenseBreakdown | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly formatter = (value: number) => EURO.format(value);

  readonly slices = computed(() =>
    (this.data()?.categories ?? []).map(c => ({ key: c.key, label: c.label, value: c.amount, slot: SLOT[c.key] })),
  );
  readonly caption = computed(() => `Distribución de gastos, ejercicio ${this.data()?.year ?? ''}`.trim());

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['year'] && this.year !== null) void this.load(this.year);
  }

  /** Conserva el reparto anterior (atenuado) mientras llega el nuevo, sin saltos de layout. */
  private async load(year: number): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.data.set(await this.dashboard.getExpenseBreakdown(this.estateId, year));
    } catch (error) {
      console.error('Error cargando la distribución de gastos de la finca', error);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
