import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CompletenessOverview } from '../../../core/office-setup.service';
import { ProgressBarComponent } from '../../../shared/components/progress-bar/progress-bar.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { formatPercent } from './overview-a-tones';

const MAX_ROWS = 6;

/**
 * «Onboarding y completitud» (S10): the despachos with the least
 * configuration first, so the ones that need help stand out. Cancelled
 * despachos (outside the average) are left out. A row opens the ficha.
 */
@Component({
  selector: 'app-overview-a-completeness',
  standalone: true,
  imports: [SectionCardComponent, ProgressBarComponent, RouterLink],
  template: `
    <app-section-card title="Onboarding y completitud" [padded]="false">
      @if (error() && !data()) {
        <p class="card-message card-message--error" role="alert">
          No se pudo cargar la completitud.
          <button type="button" class="card-retry" (click)="retry()()">Reintentar</button>
        </p>
      } @else if (!data()) {
        <p class="card-message" role="status">Cargando completitud…</p>
      } @else if (rows().length === 0) {
        <p class="card-message">Todavía no hay despachos que medir.</p>
      } @else {
        @if (average(); as avg) {
          <p class="card-note card-note--padded">Media: {{ avg }} · primero los que menos tienen configurado</p>
        }
        <ul class="rows" aria-label="Completitud por despacho">
          @for (row of rows(); track row.administratorId) {
            <li class="row row--bar">
              <span class="row__text">
                <a class="card-link" [routerLink]="['/a/admins', row.administratorId]">{{ row.name }}</a>
                <span class="row__meta">{{ row.onboardingComplete ? 'Puesta en marcha completa' : 'En onboarding' }}</span>
              </span>
              <app-progress-bar [value]="row.total" [height]="6"></app-progress-bar>
              <span class="row__side">{{ percent(row.total) }}</span>
            </li>
          }
        </ul>
      }
    </app-section-card>
  `,
  styleUrl: '../overview-a-cards.scss',
  styles: [`.card-note--padded { padding: 12px 20px 0; }`],
})
export class OverviewACompletenessComponent {
  readonly data = input<CompletenessOverview | null>(null);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly percent = formatPercent;

  readonly rows = computed(() =>
    (this.data()?.offices ?? [])
      .filter(o => o.includedInAverage)
      .sort((a, b) => a.total - b.total || a.name.localeCompare(b.name, 'es'))
      .slice(0, MAX_ROWS),
  );

  readonly average = computed(() => {
    const avg = this.data()?.average;
    return avg === null || avg === undefined ? '' : formatPercent(avg);
  });
}
