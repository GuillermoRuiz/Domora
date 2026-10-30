import { Component, computed, input, output } from '@angular/core';
import type { PropertyOverview } from '../../../core/owner-community.models';
import { KpiTileComponent, type KpiIconTone, type KpiTone } from '../../../shared/components/kpi-tile/kpi-tile.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/** Sección de la ficha de la propiedad a la que lleva cada indicador. */
export type KpiTarget = 'receipts' | 'issues' | 'juntas' | 'documents';

interface Kpi {
  id: string;
  target: KpiTarget;
  label: string;
  value: string | number;
  sub: string;
  icon: string;
  tone: KpiTone;
}

const ICON_TONE: Record<string, KpiIconTone> = { receipt: 'accent', requests: 'error', meeting: 'success', documents: 'purple' };

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MADRID_DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });
const MADRID_TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Madrid' });

/** "AAAA-MM-DD…" → día natural (sin que la zona horaria lo corra). */
const calendarDay = (iso: string) => DAY.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** New requests in the last 30 days compared with the 30 before (older responses lack that base). */
function requestsTrend(last: number, previous: number | undefined): string {
  if (last === 0 && !previous) return 'Ninguna nueva en 30 días';
  if (previous === undefined) return `+${last} en los últimos 30 días`;
  const delta = last - previous;
  if (delta === 0) return 'Igual que el mes anterior';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs. mes anterior`;
}

/**
 * Las cuatro fichas de cabecera de «Mi comunidad»: próximo recibo,
 * solicitudes abiertas, próxima junta y documentos nuevos. Cada una lleva a su
 * sección de la propiedad. Sin datos todavía (o si fallaron) muestran «—».
 */
@Component({
  selector: 'app-community-kpis',
  standalone: true,
  imports: [KpiTileComponent, IconComponent],
  templateUrl: './community-kpis.component.html',
  styleUrl: './community-kpis.component.scss',
})
export class CommunityKpisComponent {
  readonly overview = input<PropertyOverview | null>(null);
  readonly failed = input(false);
  readonly open = output<KpiTarget>();
  readonly iconTone = ICON_TONE;

  readonly kpis = computed<Kpi[]>(() => {
    const o = this.overview();
    return [this.receipt(o), this.requests(o), this.meeting(o), this.documents(o)];
  });

  private receipt(o: PropertyOverview | null): Kpi {
    const base = { id: 'receipt', target: 'receipts' as const, label: 'Próximo recibo', icon: 'receipt' };
    const r = o?.nextReceipt;
    if (!o) return { ...base, value: '—', sub: '', tone: 'default' };
    if (!r) return { ...base, value: '—', sub: 'Sin recibos pendientes', tone: 'default' };
    const overdue = r.dueDate !== null && r.dueDate.slice(0, 10) < todayUtc();
    const when = r.dueDate ? calendarDay(r.dueDate) : 'Sin fecha de vencimiento';
    return { ...base, value: EURO.format(r.amount), sub: overdue ? `${when} · vencido` : when, tone: overdue ? 'warning' : 'default' };
  }

  private requests(o: PropertyOverview | null): Kpi {
    const base = { id: 'requests', target: 'issues' as const, label: 'Incidencias abiertas', icon: 'exclamation' };
    if (!o) return { ...base, value: '—', sub: '', tone: 'default' };
    const { open, newLast30Days, newPrevious30Days } = o.requests;
    return { ...base, value: open, sub: requestsTrend(newLast30Days, newPrevious30Days), tone: open > 0 ? 'danger' : 'default' };
  }

  private meeting(o: PropertyOverview | null): Kpi {
    const base = { id: 'meeting', target: 'juntas' as const, label: 'Próxima junta', icon: 'calendar', tone: 'default' as const };
    if (!o) return { ...base, value: '—', sub: '' };
    const m = o.nextMeeting;
    if (!m) return { ...base, value: '—', sub: 'Sin juntas convocadas' };
    const at = new Date(m.scheduledAt);
    return { ...base, value: MADRID_DAY.format(at), sub: MADRID_TIME.format(at) };
  }

  private documents(o: PropertyOverview | null): Kpi {
    const base = { id: 'documents', target: 'documents' as const, label: 'Documentos nuevos', icon: 'file', tone: 'default' as const };
    if (!o) return { ...base, value: '—', sub: '' };
    return { ...base, value: o.documents.newLast30Days, sub: 'en el último mes' };
  }
}
