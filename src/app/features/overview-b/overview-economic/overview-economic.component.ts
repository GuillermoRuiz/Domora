import { Component, computed, input } from '@angular/core';
import type { EconomicSummary } from '../../../core/manager-overview.models';
import { DonutChartComponent } from '../../../shared/components/charts/donut-chart.component';
import type { DonutSlice } from '../../../shared/components/charts/chart-math';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { formatEuro } from '../overview-format';

interface Figure {
  key: string;
  label: string;
  value: string;
  hint: string;
}

/**
 * «Resumen económico»: el anillo reparte lo facturado en el ejercicio entre cobrado y pendiente (el
 * centro va vacío, D47) y, debajo, tesorería, fondo de reserva y gastos del ejercicio. En la vista
 * global cada comunidad aporta su ejercicio vigente.
 */
@Component({
  selector: 'app-overview-economic',
  standalone: true,
  imports: [SectionCardComponent, DonutChartComponent],
  templateUrl: './overview-economic.component.html',
  styleUrl: './overview-economic.component.scss',
})
export class OverviewEconomicComponent {
  readonly data = input<EconomicSummary | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly euro = (value: number) => formatEuro(value);

  readonly slices = computed<DonutSlice[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { key: 'collected', label: 'Cobrado', value: Math.max(0, d.collected), slot: 1 },
      { key: 'pending', label: 'Pendiente', value: Math.max(0, d.pending), slot: 2 },
    ];
  });

  readonly subtitle = computed(() => {
    const d = this.data();
    if (!d) return '';
    return d.fiscalYear ? `Ejercicio ${d.fiscalYear}` : 'Ejercicio vigente de cada comunidad';
  });

  readonly figures = computed<Figure[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { key: 'treasury', label: 'Tesorería', value: formatEuro(d.treasury), hint: 'Dinero en bancos y caja' },
      { key: 'reserve', label: 'Fondo de reserva', value: formatEuro(d.reserve), hint: 'Acumulado a hoy' },
      { key: 'expenses', label: 'Gastos del ejercicio', value: formatEuro(d.expenses), hint: 'Gasto devengado' },
    ];
  });
}
