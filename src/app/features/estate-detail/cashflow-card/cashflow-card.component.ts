import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { EstateCashflow } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { BarChartComponent, type BarSeries } from '../../../shared/components/charts/bar-chart.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// `useGrouping: 'always'`: como el pipe `currency` de la app, agrupa miles también en 4 cifras.
const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

/**
 * "Ingresos vs. Gastos" de la finca: barras por mes de un ejercicio, con
 * selector de año. Ingresos y gastos ocupan huecos fijos de la paleta, así
 * que su color no cambia al cambiar de año.
 */
@Component({
  selector: 'app-cashflow-card',
  standalone: true,
  imports: [SelectDropdownDirective, SectionCardComponent, BarChartComponent],
  templateUrl: './cashflow-card.component.html',
  styleUrl: './cashflow-card.component.scss',
})
export class CashflowCardComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() openAccounting = new EventEmitter<void>();
  /** Ejercicio mostrado, cada vez que se carga uno (el reparto de gastos lo sigue). */
  @Output() yearChange = new EventEmitter<number>();

  private dashboard = inject(EstateDashboardService);

  readonly data = signal<EstateCashflow | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly categories = MONTHS;
  readonly formatter = (value: number) => EURO.format(value);

  readonly series = computed<BarSeries[]>(() => {
    const months = this.data()?.months ?? [];
    return [
      { key: 'income', label: 'Ingresos', slot: 1, values: months.map(m => m.income) },
      { key: 'expenses', label: 'Gastos', slot: 2, values: months.map(m => m.expenses) },
    ];
  });

  readonly caption = computed(() => `Ingresos y gastos por mes, ejercicio ${this.data()?.year ?? ''}`.trim());

  ngOnInit(): void {
    void this.load();
  }

  async changeYear(value: string): Promise<void> {
    const year = Number(value);
    if (!Number.isInteger(year) || year === this.data()?.year) return;
    await this.load(year);
  }

  /** Mantiene el gráfico anterior (atenuado) mientras llega el nuevo, sin saltos de layout. */
  private async load(year?: number): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const data = await this.dashboard.getCashflow(this.estateId, year);
      this.data.set(data);
      this.yearChange.emit(data.year);
    } catch (error) {
      console.error('Error cargando ingresos y gastos de la finca', error);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
