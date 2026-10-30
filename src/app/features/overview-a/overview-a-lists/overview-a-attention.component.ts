import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { AttentionItem } from '../../../core/models';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { CLIENT_STATUS_TONE, PAYMENT_STATUS_TONE, formatPercent } from './overview-a-tones';

const MAX_ROWS = 5;

/**
 * «Administradores que requieren atención» (S7): the most severe despachos
 * first (order comes from the API). A row opens the ficha 360°; «Acciones»
 * offers «Ver ficha» and, with overdue payments, «Ver facturación» (ficha on
 * its Facturación tab); «Ver todos» the list of administradores.
 */
@Component({
  selector: 'app-overview-a-attention',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, RouterLink],
  template: `
    <app-section-card title="Administradores que requieren atención" actionLabel="Ver todos" [padded]="false" (action)="openAll()">
      @if (error() && !data()) {
        <p class="card-message card-message--error" role="alert">
          No se pudieron cargar los despachos que requieren atención.
          <button type="button" class="card-retry" (click)="retry()()">Reintentar</button>
        </p>
      } @else if (!data()) {
        <p class="card-message" role="status">Cargando despachos…</p>
      } @else if (rows().length === 0) {
        <p class="card-message">Ningún despacho requiere atención ahora mismo.</p>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Plan</th>
                <th scope="col">Estado</th>
                <th scope="col">Pago</th>
                <th scope="col">Completitud</th>
                <th scope="col">Salud</th>
                <th scope="col">Motivos</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.administratorId) {
                <tr (click)="open(row)">
                  <td><a class="card-link" [routerLink]="['/a/admins', row.administratorId]" (click)="$event.stopPropagation()">{{ row.name }}</a></td>
                  <td>{{ row.plan }}</td>
                  <td><app-status-pill [text]="row.clientStatus" [tone]="clientTone[row.clientStatus]"></app-status-pill></td>
                  <td><app-status-pill [text]="row.paymentStatus" [tone]="paymentTone[row.paymentStatus]"></app-status-pill></td>
                  <td class="table__num">{{ percent(row.completeness) }}</td>
                  <td class="table__num">
                    @if (row.salud === null) {
                      —
                    } @else {
                      {{ number(row.salud) }}
                      @if (row.atRisk) {
                        <app-status-pill text="En riesgo" tone="danger"></app-status-pill>
                      }
                    }
                  </td>
                  <td>
                    <ul class="table__reasons">
                      @for (reason of row.reasons; track reason.code) {
                        <li>{{ reason.label }}</li>
                      }
                    </ul>
                  </td>
                  <td>
                    <!-- Links (not the row click): reachable by keyboard; stopPropagation avoids a double navigation. -->
                    <div class="table__actions">
                      <a class="card-link" [routerLink]="['/a/admins', row.administratorId]"
                         [attr.aria-label]="'Ver ficha de ' + row.name" (click)="$event.stopPropagation()">Ver ficha</a>
                      @if (hasOverduePayment(row)) {
                        <a class="card-link" [routerLink]="['/a/admins', row.administratorId]" [queryParams]="{ tab: 'facturacion' }"
                           [attr.aria-label]="'Ver facturación de ' + row.name" (click)="$event.stopPropagation()">Ver facturación</a>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-section-card>
  `,
  styleUrl: '../overview-a-cards.scss',
})
export class OverviewAAttentionComponent {
  private readonly router = inject(Router);

  readonly data = input<AttentionItem[] | null>(null);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);

  readonly clientTone = CLIENT_STATUS_TONE;
  readonly paymentTone = PAYMENT_STATUS_TONE;
  readonly percent = formatPercent;
  readonly number = (v: number): string => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

  readonly rows = computed(() => (this.data() ?? []).slice(0, MAX_ROWS));

  /** «Ver facturación» only makes sense when overdue payment is one of the reasons. */
  hasOverduePayment(row: AttentionItem): boolean {
    return row.reasons.some((r) => r.code === 'overdue_payment');
  }

  open(row: AttentionItem): void {
    void this.router.navigate(['/a/admins', row.administratorId]);
  }

  openAll(): void {
    void this.router.navigate(['/a/admins']);
  }
}
