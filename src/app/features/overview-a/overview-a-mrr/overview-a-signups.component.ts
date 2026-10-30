import { Component, computed, input } from '@angular/core';
import type { MrrOverview } from '../../../core/platform-metrics.service';
import { BarChartComponent, type BarSeries } from '../../../shared/components/charts/bar-chart.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { historyMonths, monthLabel } from '../overview-a-kpis';

/**
 * «Altas y bajas de clientes» (S12): per month, clients that start paying
 * (new or back) against clients that stop paying, from the MRR snapshots.
 */
@Component({
  selector: 'app-overview-a-signups',
  standalone: true,
  imports: [SectionCardComponent, BarChartComponent],
  template: `
    <app-section-card title="Altas y bajas de clientes">
      @if (error() && !data()) {
        <p class="card-message card-message--error" role="alert">
          No se pudieron cargar las altas y bajas.
          <button type="button" class="card-retry" (click)="retry()()">Reintentar</button>
        </p>
      } @else if (!data()) {
        <p class="card-message" role="status">Cargando altas y bajas…</p>
      } @else {
        <app-bar-chart
          [categories]="categories()"
          [series]="series()"
          caption="Clientes que empiezan a pagar y que dejan de pagar, por mes"
          [valueFormatter]="count"
          [integerTicks]="true"
          [height]="240"
          emptyText="Sin altas ni bajas en el periodo"
        ></app-bar-chart>
      }
    </app-section-card>
  `,
  styleUrl: '../overview-a-cards.scss',
})
export class OverviewASignupsComponent {
  readonly data = input<MrrOverview | null>(null);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly count = (v: number): string => (v === 1 ? '1 cliente' : `${v} clientes`);

  private readonly months = computed(() => {
    const data = this.data();
    return data ? historyMonths(data) : [];
  });

  readonly categories = computed(() => this.months().map(m => monthLabel(m.month)));
  readonly series = computed<BarSeries[]>(() => [
    { key: 'signups', label: 'Altas', values: this.months().map(m => m.movements.signups), slot: 3 },
    { key: 'cancellations', label: 'Bajas', values: this.months().map(m => m.movements.cancellations), slot: 2 },
  ]);
}
