import { Component, input, output } from '@angular/core';
import type { PendingItem, PendingToday, PendingUrgency } from '../../../core/manager-overview.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

const URGENCY: Record<PendingUrgency, { text: string; tone: StatusTone }> = {
  urgente: { text: 'Urgente', tone: 'danger' },
  hoy: { text: 'Hoy', tone: 'warning' },
  esta_semana: { text: 'Esta semana', tone: 'info' },
};

const KIND_ICON: Record<PendingItem['kind'], string> = {
  receipt: 'receipt',
  installation: 'wrench',
  inspection: 'shield',
  contract: 'file-text',
  adhesion: 'user',
};

/**
 * «Pendientes de hoy»: lo que el gestor debe atender, de lo más urgente a lo menos. El número de la
 * cabecera es el total aunque solo se vean 6 filas a la vez (el resto, con scroll). Cada fila lleva a
 * la gestión que la resuelve.
 */
@Component({
  selector: 'app-overview-pending',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, IconComponent],
  templateUrl: './overview-pending.component.html',
  styleUrl: './overview-pending.component.scss',
})
export class OverviewPendingComponent {
  readonly data = input<PendingToday | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);
  readonly open = output<PendingItem>();

  urgency(item: PendingItem) {
    return URGENCY[item.urgency];
  }
  icon(item: PendingItem): string {
    return KIND_ICON[item.kind];
  }
}
