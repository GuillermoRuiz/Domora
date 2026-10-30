import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { EstateRecentProperties, RecentPropertyStatus } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

const STATUS: Record<RecentPropertyStatus, { text: string; tone: StatusTone }> = {
  ok: { text: 'Al día', tone: 'positive' },
  overdue: { text: 'En mora', tone: 'warning' },
};
// `useGrouping: 'always'`: como el pipe `currency` de la app, agrupa miles también en 4 cifras.
const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const TYPE_LABEL: Record<string, string> = { Piso: 'Vivienda', Casa: 'Vivienda', Parking: 'Parking', Trastero: 'Trastero', Local: 'Local comercial' };

/** "Propiedades (últimas 5)": las dadas de alta más recientemente, con su estado de un vistazo. */
@Component({
  selector: 'app-properties-card',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, IconComponent],
  templateUrl: './properties-card.component.html',
  styleUrl: './properties-card.component.scss',
})
export class PropertiesCardComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** Todas las propiedades de la pestaña "Propiedades". */
  @Output() viewAll = new EventEmitter<void>();
  /** Abrir una propiedad concreta (su edición, en la pestaña "Propiedades"). */
  @Output() openProperty = new EventEmitter<string>();

  private dashboard = inject(EstateDashboardService);

  readonly data = signal<EstateRecentProperties | null>(null);
  readonly failed = signal(false);

  readonly actionLabel = computed(() => {
    const total = this.data()?.total ?? 0;
    return total > 5 ? `Ver todas (${total})` : 'Ver todas';
  });

  readonly rows = computed(() =>
    (this.data()?.items ?? []).map(item => ({
      id: item.id,
      ref: item.ref ?? '—',
      type: TYPE_LABEL[item.type] ?? item.type,
      titular: item.titular ?? '—',
      status: STATUS[item.status],
      quota: EURO.format(item.quotaMonthly),
      balance: EURO.format(item.balance),
      owes: item.balance > 0,
    })),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.dashboard.getRecentProperties(this.estateId));
    } catch (error) {
      console.error('Error cargando las últimas propiedades de la finca', error);
      this.failed.set(true);
    }
  }
}
