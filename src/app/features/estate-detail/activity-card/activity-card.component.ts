import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { ActivitySubjectType, EstateActivityItem } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { EstateTab } from '../../../core/estate-navigation.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

/** Destino de cada tipo de actividad: una sección de la ficha o la contabilidad de la finca. */
export type ActivityTarget = EstateTab | 'accounting';

const TARGET: Record<ActivitySubjectType, ActivityTarget> = {
  issue: 'issues',
  receipt: 'accounting',
  communication: 'communications',
  document: 'documents',
  membership: 'properties',
  regulatory_inspection: 'inspections',
  meeting: 'juntas',
  property: 'properties',
  fiscal_year: 'accounting',
};

const ICON: Record<ActivitySubjectType, string> = {
  issue: 'exclamation',
  receipt: 'receipt',
  communication: 'mail',
  document: 'file',
  membership: 'users',
  regulatory_inspection: 'check',
  meeting: 'gavel',
  property: 'building',
  fiscal_year: 'calendar',
};

/** Entradas que caben en la tarjeta sin alargar la fila de paneles. */
const VISIBLE_ENTRIES = 5;

const DAY_MONTH = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Hoy, 10:24" · "Ayer, 16:30" · "12 abr, 11:20" (en la zona horaria del navegador). */
export function activityTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const time = TIME.format(date);
  if (days === 0) return `Hoy, ${time}`;
  if (days === 1) return `Ayer, ${time}`;
  return `${DAY_MONTH.format(date)}, ${time}`;
}

interface ActivityRow {
  id: string;
  summary: string;
  detail: string;
  time: string;
  icon: string;
  target: ActivityTarget;
}

/** "Actividad reciente": lo último que ha pasado en la finca; cada entrada lleva a su sección. */
@Component({
  selector: 'app-activity-card',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './activity-card.component.html',
  styleUrl: './activity-card.component.scss',
})
export class ActivityCardComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() openTarget = new EventEmitter<ActivityTarget>();

  private dashboard = inject(EstateDashboardService);

  readonly items = signal<EstateActivityItem[] | null>(null);
  readonly failed = signal(false);

  readonly rows = computed<ActivityRow[]>(() => {
    const now = new Date();
    return (this.items() ?? []).map(item => ({
      id: item.id,
      summary: item.summary,
      detail: [item.propertyRef ? `Prop. ${item.propertyRef}` : null, item.actorName].filter(Boolean).join(' · '),
      time: activityTimeLabel(item.occurredAt, now),
      icon: ICON[item.subjectType],
      target: TARGET[item.subjectType],
    }));
  });

  async ngOnInit(): Promise<void> {
    try {
      this.items.set((await this.dashboard.getActivity(this.estateId, VISIBLE_ENTRIES)).items);
    } catch (error) {
      console.error('Error cargando la actividad reciente de la finca', error);
      this.failed.set(true);
    }
  }
}
