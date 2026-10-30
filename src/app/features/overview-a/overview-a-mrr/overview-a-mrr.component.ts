import { Component, computed, input, signal } from '@angular/core';
import type { MrrMovements, MrrOverview } from '../../../core/platform-metrics.service';
import { LineChartComponent } from '../../../shared/components/charts/line-chart.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { formatEuro } from '../../overview-b/overview-format';
import { historyMonths, monthLabel, sinceLabel } from '../overview-a-kpis';

export type MrrView = 'mrr' | keyof Pick<MrrMovements, 'new' | 'expansion' | 'contraction' | 'churn' | 'reactivation'>;

const VIEWS: { key: MrrView; label: string }[] = [
  { key: 'mrr', label: 'MRR total' },
  { key: 'new', label: 'Nuevo' },
  { key: 'expansion', label: 'Expansión' },
  { key: 'contraction', label: 'Contracción' },
  { key: 'churn', label: 'Churn' },
  { key: 'reactivation', label: 'Reactivación' },
];

/** «Evolución MRR» (S9): MRR total of the last 12 months or one of its movements, picked in the header. */
@Component({
  selector: 'app-overview-a-mrr',
  standalone: true,
  imports: [SectionCardComponent, LineChartComponent],
  template: `
    <app-section-card title="Evolución MRR">
      @if (data()) {
        <label slot="tools" class="card-select-label">
          Mostrar
          <select class="card-select" [value]="view()" (change)="pick($event)">
            @for (v of views; track v.key) {
              <option [value]="v.key">{{ v.label }}</option>
            }
          </select>
        </label>
      }
      @if (error() && !data()) {
        <p class="card-message card-message--error" role="alert">
          No se pudo cargar el MRR.
          <button type="button" class="card-retry" (click)="retry()()">Reintentar</button>
        </p>
      } @else if (!data()) {
        <p class="card-message" role="status">Cargando MRR…</p>
      } @else {
        <app-line-chart
          [categories]="categories()"
          [values]="values()"
          [label]="viewLabel()"
          [area]="view() === 'mrr'"
          [caption]="viewLabel() + ' por mes (€/mes, sin IVA)'"
          [valueFormatter]="euro"
          [height]="240"
          emptyText="Sin movimientos de este tipo en el periodo"
        ></app-line-chart>
        <p class="card-note">Datos desde {{ since() }}: el MRR se guarda al cierre de cada mes desde entonces.</p>
      }
    </app-section-card>
  `,
  styleUrl: '../overview-a-cards.scss',
})
export class OverviewAMrrComponent {
  readonly data = input<MrrOverview | null>(null);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly views = VIEWS;
  readonly view = signal<MrrView>('mrr');
  readonly euro = (v: number): string => formatEuro(v);

  private readonly months = computed(() => {
    const data = this.data();
    return data ? historyMonths(data) : [];
  });

  readonly categories = computed(() => this.months().map(m => monthLabel(m.month)));
  readonly values = computed(() => {
    const view = this.view();
    return this.months().map(m => (view === 'mrr' ? m.mrr : m.movements[view]));
  });
  readonly viewLabel = computed(() => VIEWS.find(v => v.key === this.view())!.label);
  readonly since = computed(() => {
    const data = this.data();
    return data ? sinceLabel(data.dataSince) : '';
  });

  pick(event: Event): void {
    this.view.set((event.target as HTMLSelectElement).value as MrrView);
  }
}
