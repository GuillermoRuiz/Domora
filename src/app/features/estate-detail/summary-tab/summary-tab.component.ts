import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Estate } from '../../../core/models';
import { EstateDashboardSummary } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { EstateFacadeThumbnailComponent } from '../../dashboard-b/estate-facade-thumbnail/estate-facade-thumbnail.component';
import { CashflowCardComponent } from '../cashflow-card/cashflow-card.component';
import { PropertiesCardComponent } from '../properties-card/properties-card.component';
import { ActivityCardComponent, type ActivityTarget } from '../activity-card/activity-card.component';
import { MilestonesCardComponent } from '../milestones-card/milestones-card.component';
import { ExpenseBreakdownCardComponent } from '../expense-breakdown-card/expense-breakdown-card.component';
import { EstateTab } from '../../../core/estate-navigation.service';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { KpiTileComponent, type KpiTone } from '../../../shared/components/kpi-tile/kpi-tile.component';

interface KpiView {
  id: string;
  label: string;
  value: string;
  sub: string;
  icon: string;
  tone: KpiTone;
  /** Dónde lleva al pulsarla: una sección de la ficha o la contabilidad de la finca. */
  target: { tab: EstateTab } | { accounting: true };
}

// `useGrouping: 'always'`: el pipe `currency` del resto de la app agrupa miles también en 4 cifras (9.316,08 €).
const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const MEETING_DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Pestaña Resumen de la finca (rol B). Se va construyendo por bloques; de
 * momento: la fila de indicadores la tarjeta de presentación ingresos vs. gastos, reparto de gastos, próximos hitos, actividad reciente y las últimas propiedades. Cada indicador lleva a la sección donde
 * se gestiona (también a las que ya no tienen pestaña propia).
 */
@Component({
  selector: 'app-summary-tab',
  standalone: true,
  imports: [KpiTileComponent, BtnComponent, IconComponent, EstateFacadeThumbnailComponent, CashflowCardComponent, ExpenseBreakdownCardComponent, MilestonesCardComponent, ActivityCardComponent, PropertiesCardComponent],
  templateUrl: './summary-tab.component.html',
  styleUrl: './summary-tab.component.scss',
})
export class SummaryTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** La finca, para la tarjeta de presentación. */
  @Input() estate: Estate | null = null;
  @Output() openTab = new EventEmitter<EstateTab>();
  @Output() addProperty = new EventEmitter<void>();
  /** Abrir una propiedad concreta (el padre cambia a la pestaña Propiedades y abre su edición). */
  @Output() openProperty = new EventEmitter<string>();
  @Output() editEstate = new EventEmitter<void>();

  private dashboard = inject(EstateDashboardService);
  private router = inject(Router);

  readonly summary = signal<EstateDashboardSummary | null>(null);
  /** Ejercicio de las gráficas: lo elige la tarjeta de ingresos y gastos y el reparto de gastos lo sigue. */
  readonly year = signal<number | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly kpis = computed<KpiView[]>(() => {
    const s = this.summary();
    const dash = '—';
    const meeting = s?.nextMeeting;
    return [
      {
        id: 'units', label: 'Propiedades', icon: 'building', tone: 'default',
        value: s ? String(s.units) : dash, sub: 'unidades', target: { tab: 'properties' },
      },
      {
        id: 'balance', label: 'Saldo actual', icon: 'card',
        tone: s ? (s.balance < 0 ? 'danger' : 'positive') : 'default',
        value: s ? EURO.format(s.balance) : dash, sub: 'en bancos y caja', target: { accounting: true },
      },
      {
        id: 'issues', label: 'Incidencias abiertas', icon: 'exclamation', tone: 'default',
        value: s ? String(s.issues.open) : dash,
        sub: s ? `de ${s.issues.thisYear} este año` : '', target: { tab: 'issues' },
      },
      {
        id: 'dues', label: 'Cuotas pendientes', icon: 'receipt',
        tone: s && s.pendingDues.amount > 0 ? 'warning' : 'default',
        value: s ? EURO.format(s.pendingDues.amount) : dash,
        sub: s ? this.propertiesLabel(s.pendingDues.properties) : '', target: { accounting: true },
      },
      {
        id: 'meeting', label: 'Próxima junta', icon: 'calendar', tone: 'default',
        value: meeting ? MEETING_DATE.format(new Date(meeting.scheduledAt)) : dash,
        sub: s ? (meeting ? (meeting.type === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria') : 'Sin junta convocada') : '',
        target: { tab: 'juntas' },
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    try {
      this.summary.set(await this.dashboard.getSummary(this.estateId));
    } catch (error) {
      console.error('Error cargando el resumen de la finca', error);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  openAccounting(): void {
    void this.router.navigate(['/b/accounting', this.estateId]);
  }

  heroAddress(): string {
    const e = this.estate;
    if (!e) return '';
    return [[e.address, e.streetNumber].filter(Boolean).join(' '), e.location].filter(Boolean).join(', ');
  }

  openActivityTarget(target: ActivityTarget): void {
    if (target === 'accounting') this.openAccounting();
    else this.openTab.emit(target);
  }

  go(kpi: KpiView): void {
    if ('tab' in kpi.target) this.openTab.emit(kpi.target.tab);
    else this.openAccounting();
  }

  private propertiesLabel(count: number): string {
    if (count === 0) return 'ninguna propiedad';
    return count === 1 ? 'en 1 propiedad' : `en ${count} propiedades`;
  }
}
