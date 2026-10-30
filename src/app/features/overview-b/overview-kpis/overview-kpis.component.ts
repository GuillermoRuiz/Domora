import { Component, computed, input } from '@angular/core';
import type { KpiCard, ManagerKpis } from '../../../core/manager-overview.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { changeTone, formatChange, formatEuro, type ChangeTone } from '../overview-format';

interface KpiTileView {
  key: string;
  label: string;
  icon: string;
  value: string;
  change: string;
  tone: ChangeTone;
  trendIcon: 'trending-up' | 'trending-down' | null;
  comparison: string;
  aria: string;
}

interface KpiDef {
  key: keyof Omit<ManagerKpis, 'estateId' | 'generatedAt'>;
  label: string;
  icon: string;
  goodWhen: 'up' | 'down';
  money?: boolean;
  comparison: string;
}

const SIX_MONTHS = 'frente a hace 6 meses';
const DEFS: readonly KpiDef[] = [
  { key: 'estates', label: 'Fincas gestionadas', icon: 'building', goodWhen: 'up', comparison: SIX_MONTHS },
  { key: 'activeIssues', label: 'Incidencias pendientes', icon: 'exclamation', goodWhen: 'down', comparison: SIX_MONTHS },
  { key: 'pendingDues', label: 'Cuotas pendientes', icon: 'receipt', goodWhen: 'down', money: true, comparison: SIX_MONTHS },
  { key: 'pendingRequests', label: 'Solicitudes sin responder', icon: 'mail', goodWhen: 'down', comparison: SIX_MONTHS },
  { key: 'upcomingMeetings', label: 'Próximas juntas', icon: 'users', goodWhen: 'up', comparison: 'próximos 6 meses frente a los 6 anteriores' },
];

/** Las cinco fichas KPI de la vista general, con su variación frente a hace 6 meses. */
@Component({
  selector: 'app-overview-kpis',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './overview-kpis.component.html',
  styleUrl: './overview-kpis.component.scss',
})
export class OverviewKpisComponent {
  readonly kpis = input<ManagerKpis | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly tiles = computed<KpiTileView[]>(() => {
    const kpis = this.kpis();
    return DEFS.map((def) => {
      const card: KpiCard | undefined = kpis?.[def.key];
      if (!card) {
        return { key: def.key, label: def.label, icon: def.icon, value: '—', change: '', tone: 'neutral', trendIcon: null, comparison: def.comparison, aria: `${def.label}: sin datos` };
      }
      const value = def.money ? formatEuro(card.value) : card.value.toLocaleString('es-ES');
      const change = formatChange(card.change);
      const trendIcon = card.change.type === 'new' || card.change.value > 0 ? 'trending-up' : card.change.value < 0 ? 'trending-down' : null;
      return {
        key: def.key, label: def.label, icon: def.icon, value, change, tone: changeTone(card.change, def.goodWhen), trendIcon, comparison: def.comparison,
        aria: `${def.label}: ${value}, ${change} ${def.comparison}`,
      };
    });
  });
}
