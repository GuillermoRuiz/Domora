import { Component, computed, input, output } from '@angular/core';
import type { ManagerMilestones, MilestoneItem, MilestoneKind } from '../../../core/manager-overview.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

const KIND_ICON: Record<MilestoneKind, string> = { meeting: 'users', inspection: 'shield', contract: 'file-text' };
const KIND_LABEL: Record<MilestoneKind, string> = { meeting: 'Junta', inspection: 'Revisión', contract: 'Contrato' };

interface MilestoneView {
  item: MilestoneItem;
  day: string;
  month: string;
  when: string;
  icon: string;
  kind: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Las juntas traen hora (instante ISO); las revisiones y los contratos, solo la fecha. */
function parts(item: MilestoneItem): { day: string; month: string; when: string } {
  const hasTime = item.date.length > 10;
  const date = hasTime ? new Date(item.date) : new Date(`${item.date}T00:00:00`);
  const time = hasTime ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
  return {
    day: String(date.getDate()),
    month: MONTHS[date.getMonth()] as string,
    when: date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + (time ? `, ${time}` : ''),
  };
}

/**
 * «Próximos hitos»: lo que ocurre en los próximos 30 días (juntas, revisiones, vencimiento de
 * contratos), por fecha. 6 filas a la vista y el resto con scroll; no hay «Ver todas».
 */
@Component({
  selector: 'app-overview-milestones',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './overview-milestones.component.html',
  styleUrl: './overview-milestones.component.scss',
})
export class OverviewMilestonesComponent {
  readonly data = input<ManagerMilestones | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);
  readonly open = output<MilestoneItem>();

  readonly rows = computed<MilestoneView[]>(() =>
    (this.data()?.items ?? []).map((item) => ({ item, ...parts(item), icon: KIND_ICON[item.kind], kind: KIND_LABEL[item.kind] })),
  );
}
