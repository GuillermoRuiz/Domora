import { Component, computed, input, output } from '@angular/core';
import type { PropertyEvent, PropertyEventKind } from '../../../core/owner-community.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

/** Sección de la propiedad a la que lleva un evento. */
export type EventSection = 'juntas' | 'receipts' | 'reservas';

const ICON: Record<PropertyEventKind, string> = { junta: 'users', recibo: 'receipt', reserva: 'calendar', revision: 'wrench' };
/** Las revisiones de instalaciones se enseñan pero no tienen pantalla a la que ir. */
const TARGET: Partial<Record<PropertyEventKind, EventSection>> = { junta: 'juntas', recibo: 'receipts', reserva: 'reservas' };

const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });

interface Row {
  event: PropertyEvent;
  day: string;
  month: string;
  icon: string;
  detail: string;
  target: EventSection | null;
}

/**
 * «Próximos eventos»: juntas, vencimientos de recibo, reservas propias y
 * revisiones de instalaciones de la comunidad. De las revisiones solo se ve qué
 * es, sobre qué instalación y cuándo.
 */
@Component({
  selector: 'app-community-events',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './community-events.component.html',
  styleUrl: './community-events.component.scss',
})
export class CommunityEventsComponent {
  /** El más cercano primero; null mientras carga. */
  readonly events = input<PropertyEvent[] | null>(null);
  readonly failed = input(false);
  readonly open = output<EventSection>();

  readonly rows = computed<Row[]>(() =>
    (this.events() ?? []).map(event => {
      const at = new Date(`${event.date}T00:00:00Z`);
      return {
        event,
        day: String(at.getUTCDate()),
        month: MONTH.format(at).replace('.', ''),
        icon: ICON[event.kind] ?? 'calendar',
        detail: [event.subtitle, event.time].filter((p): p is string => !!p).join(' · '),
        target: TARGET[event.kind] ?? null,
      };
    }),
  );
}
