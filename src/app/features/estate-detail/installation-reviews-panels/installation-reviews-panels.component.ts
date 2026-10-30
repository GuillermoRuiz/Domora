import { Component, computed, input, output, signal } from '@angular/core';
import { installationTypeFor } from '../../../core/installation-types';
import { reviewDeadlineLabel, type UpcomingReview } from '../../../core/installations.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

/** Filas que caben en cada tarjeta sin alargar la página (la del calendario puede ampliarse). */
const NEXT_ROWS = 4;
const CALENDAR_ROWS = 6;
const SOON_DAYS = 30;

const MONTH_SHORT = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
const MONTH_LONG = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface ReviewRow {
  key: string;
  assetId: string;
  assetName: string;
  title: string;
  location: string | null;
  supplier: string | null;
  icon: string;
  day: string;
  month: string;
  tone: 'danger' | 'warning' | 'default';
  pill: { text: string; tone: StatusTone };
}

interface ReviewGroup {
  label: string;
  rows: ReviewRow[];
}

/**
 * Los dos paneles de debajo de la tabla de Instalaciones: "Próximos
 * mantenimientos y revisiones" (lo más inmediato) y el calendario de revisiones
 * de los próximos 6 meses, agrupado por mes. Solo revisiones normativas.
 */
@Component({
  selector: 'app-installation-reviews-panels',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, IconComponent],
  templateUrl: './installation-reviews-panels.component.html',
  styleUrl: './installation-reviews-panels.component.scss',
})
export class InstallationReviewsPanelsComponent {
  readonly upcoming = input<UpcomingReview[]>([]);
  /** Pulsar una revisión: abre la ficha de su instalación. */
  readonly openAsset = output<string>();
  /** "Ver calendario": ir a Tareas. */
  readonly openCalendar = output<void>();

  readonly expanded = signal(false);

  private readonly rows = computed<(ReviewRow & { overdue: boolean; month6: string })[]>(() =>
    this.upcoming().map(review => {
      const date = asDate(review.dueDate);
      const tone: ReviewRow['tone'] = review.overdue ? 'danger' : review.daysLeft <= SOON_DAYS ? 'warning' : 'default';
      return {
        key: review.inspectionId,
        assetId: review.assetId,
        assetName: review.assetName,
        title: review.title,
        location: review.location,
        supplier: review.supplierName,
        icon: installationTypeFor(review.category).icon,
        day: review.dueDate.slice(8, 10),
        month: MONTH_SHORT.format(date).replace('.', ''),
        tone,
        pill: { text: capitalize(reviewDeadlineLabel(review.daysLeft)), tone: tone === 'default' ? 'neutral' : tone },
        overdue: review.overdue,
        month6: capitalize(MONTH_LONG.format(date)),
      };
    }),
  );

  readonly next = computed(() => this.rows().slice(0, NEXT_ROWS));

  readonly calendarActionLabel = computed(() => (this.expanded() ? 'Ver menos' : 'Ver todos'));
  readonly hasMore = computed(() => this.rows().length > CALENDAR_ROWS);

  /** Vencidas primero ("Vencidas"), luego un grupo por mes; cada grupo conserva el orden por fecha. */
  readonly calendar = computed<ReviewGroup[]>(() => {
    const shown = this.expanded() ? this.rows() : this.rows().slice(0, CALENDAR_ROWS);
    const groups: ReviewGroup[] = [];
    for (const row of shown) {
      const label = row.overdue ? 'Vencidas' : row.month6;
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else groups.push({ label, rows: [row] });
    }
    return groups;
  });

  toggle(): void {
    this.expanded.set(!this.expanded());
  }
}
