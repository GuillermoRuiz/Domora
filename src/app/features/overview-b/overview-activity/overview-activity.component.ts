import { Component, computed, input } from '@angular/core';
import type { ActivitySubjectType, ManagerActivity, ManagerActivityItem } from '../../../core/manager-overview.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

const ICONS: Record<ActivitySubjectType, string> = {
  issue: 'exclamation',
  receipt: 'receipt',
  communication: 'send',
  document: 'file-text',
  membership: 'user',
  regulatory_inspection: 'shield',
  meeting: 'users',
  property: 'building',
  fiscal_year: 'calendar',
  supplier: 'wrench',
  message: 'mail',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** «hace 5 min», «hace 3 h», «ayer», «hace 4 días» o la fecha si pasó más de un mes. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return 'ahora mismo';
  if (diff < HOUR) return `hace ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `hace ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'ayer';
  if (days < 31) return `hace ${days} días`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface ActivityView {
  item: ManagerActivityItem;
  icon: string;
  ago: string;
  exact: string;
}

/**
 * «Actividad reciente»: las 5 últimas acciones del propio gestor. Cada gestor ve solo la suya y no
 * hay «Ver todas». Los mensajes de la bandeja no pertenecen a ninguna finca y solo salen en la vista
 * global.
 */
@Component({
  selector: 'app-overview-activity',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './overview-activity.component.html',
  styleUrl: './overview-activity.component.scss',
})
export class OverviewActivityComponent {
  readonly data = input<ManagerActivity | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);
  /** Inyectable para fijar «ahora» en los tests. */
  readonly now = input<Date | null>(null);

  readonly rows = computed<ActivityView[]>(() => {
    const now = this.now() ?? new Date();
    return (this.data()?.items ?? []).map((item) => ({
      item,
      icon: ICONS[item.subjectType] ?? 'sparkles',
      ago: timeAgo(item.occurredAt, now),
      exact: new Date(item.occurredAt).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }),
    }));
  });
}
