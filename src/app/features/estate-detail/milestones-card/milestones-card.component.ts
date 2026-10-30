import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { EstateMilestone, MilestoneKind } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { EstateTab } from '../../../core/estate-navigation.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

/** Sección de la ficha donde se gestiona cada tipo de hito (las que ya no tienen pestaña se alcanzan igual). */
const TARGET: Record<MilestoneKind, EstateTab> = { meeting: 'juntas', inspection: 'inspections', contract: 'contracts' };
const ICON: Record<MilestoneKind, string> = { meeting: 'gavel', inspection: 'check', contract: 'file-text' };
const DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

interface MilestoneRow {
  key: string;
  title: string;
  date: string;
  icon: string;
  tab: EstateTab;
  pill: { text: string; tone: StatusTone };
}

/** `YYYY-MM-DD` es un día de calendario (sin zona horaria); un ISO con hora es un instante. */
function parseDate(value: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
}

/**
 * "Próximos hitos": lo siguiente que le toca a la finca (juntas,
 * inspecciones, vencimientos de contratos). Lo vencido va primero y marcado;
 * el primer hito que aún no ha pasado se destaca como "Próximo".
 */
@Component({
  selector: 'app-milestones-card',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, IconComponent],
  templateUrl: './milestones-card.component.html',
  styleUrl: './milestones-card.component.scss',
})
export class MilestonesCardComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() openTab = new EventEmitter<EstateTab>();

  private dashboard = inject(EstateDashboardService);

  readonly items = signal<EstateMilestone[] | null>(null);
  readonly failed = signal(false);

  readonly rows = computed<MilestoneRow[]>(() => {
    const items = this.items() ?? [];
    const firstUpcoming = items.findIndex(i => !i.overdue);
    return items.map((item, index) => ({
      key: item.key,
      title: item.title,
      date: DATE.format(parseDate(item.date)),
      icon: ICON[item.kind],
      tab: TARGET[item.kind],
      pill: item.overdue
        ? { text: 'Vencido', tone: 'danger' as const }
        : index === firstUpcoming
          ? { text: 'Próximo', tone: 'info' as const }
          : { text: 'Programado', tone: 'neutral' as const },
    }));
  });

  async ngOnInit(): Promise<void> {
    try {
      this.items.set((await this.dashboard.getMilestones(this.estateId)).items);
    } catch (error) {
      console.error('Error cargando los próximos hitos de la finca', error);
      this.failed.set(true);
    }
  }
}
