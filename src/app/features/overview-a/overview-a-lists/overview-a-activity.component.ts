import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AdminActivityType } from '../../../core/models';
import type { PlatformEvent } from '../../../core/platform-metrics.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { timeAgo } from '../../overview-b/overview-activity/overview-activity.component';

const ICONS: Partial<Record<AdminActivityType, string>> = {
  signup: 'user',
  plan_change: 'repeat',
  payment_received: 'card',
  cancellation_requested: 'x',
  onboarding_completed: 'check-check',
};

/**
 * «Actividad reciente» (S11): business events of the despachos (alta, cambio
 * de plan, pago recibido, solicitud de baja, onboarding completado), never the
 * owners' daily activity. The despacho name opens its ficha.
 */
@Component({
  selector: 'app-overview-a-activity',
  standalone: true,
  imports: [SectionCardComponent, IconComponent, RouterLink],
  template: `
    <app-section-card title="Actividad reciente" [padded]="false">
      @if (error() && !data()) {
        <p class="card-message card-message--error" role="alert">
          No se pudo cargar la actividad.
          <button type="button" class="card-retry" (click)="retry()()">Reintentar</button>
        </p>
      } @else if (!data()) {
        <p class="card-message" role="status">Cargando actividad…</p>
      } @else if (rows().length === 0) {
        <p class="card-message">Todavía no hay actividad de negocio.</p>
      } @else {
        <ul class="rows" aria-label="Actividad reciente de los despachos">
          @for (row of rows(); track row.event.id) {
            <li class="row" [attr.data-icon]="row.icon">
              <span class="row__icon" aria-hidden="true"><app-icon [name]="row.icon" [size]="16"></app-icon></span>
              <span class="row__text">
                {{ row.event.title }}
                <a class="card-link row__meta" [routerLink]="['/a/admins', row.event.administrator.id]">{{ row.event.administrator.name }}</a>
              </span>
              <time class="row__side" [attr.datetime]="row.event.occurredAt" [attr.title]="row.exact">{{ row.ago }}</time>
            </li>
          }
        </ul>
      }
    </app-section-card>
  `,
  styleUrl: '../overview-a-cards.scss',
})
export class OverviewAActivityComponent {
  readonly data = input<PlatformEvent[] | null>(null);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);
  /** Injectable to pin «now» in tests. */
  readonly now = input<Date | null>(null);

  readonly rows = computed(() => {
    const now = this.now() ?? new Date();
    return (this.data() ?? []).map(event => ({
      event,
      icon: ICONS[event.type] ?? 'clock',
      ago: timeAgo(event.occurredAt, now),
      exact: new Date(event.occurredAt).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }),
    }));
  });
}
