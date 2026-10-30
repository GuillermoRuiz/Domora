import { Component, computed, input, output } from '@angular/core';
import type { ActivityItem, ActivityType } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

/** Cuántas actividades enseña la tarjeta. */
const VISIBLE = 5;

const COLOR: Record<ActivityType, string> = {
  incidencia: 'var(--color-error)',
  recibo: 'var(--color-warning)',
  comunicado: '#2563EB',
  documento: 'var(--color-secondary)',
  solicitud: 'var(--color-accent)',
};
const ICON: Record<ActivityType, string> = {
  incidencia: 'exclamation',
  recibo: 'receipt',
  comunicado: 'mail',
  documento: 'file',
  solicitud: 'check',
};

const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** «Hoy», «Ayer» o «12 mar 2025» (el día natural que trae la actividad, sin que la zona horaria lo corra). */
export function activityDayLabel(isoDay: string, now: Date = new Date()): string {
  const day = isoDay.slice(0, 10);
  if (day === dayKey(now)) return 'Hoy';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === dayKey(yesterday)) return 'Ayer';
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

interface Row {
  item: ActivityItem;
  /** Una incidencia abre la comunidad; un recibo, su propiedad. */
  clickable: boolean;
  color: string;
  icon: string;
  when: string;
}

/** «Actividad reciente»: lo último que ha pasado en la comunidad y en las propiedades del usuario. */
@Component({
  selector: 'app-community-activity',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './community-activity.component.html',
  styleUrl: './community-activity.component.scss',
})
export class CommunityActivityComponent {
  /** Lo más nuevo primero; null mientras carga. */
  readonly items = input<ActivityItem[] | null>(null);
  readonly failed = input(false);
  readonly viewAll = output<void>();
  readonly openItem = output<ActivityItem>();

  readonly rows = computed<Row[]>(() =>
    (this.items() ?? []).slice(0, VISIBLE).map(item => ({
      item,
      clickable: item.type === 'incidencia' || item.type === 'documento' || (item.type === 'recibo' && !!item.propertyId),
      color: COLOR[item.type] ?? 'var(--color-muted)',
      icon: ICON[item.type] ?? 'check',
      when: activityDayLabel(item.date),
    })),
  );
}
