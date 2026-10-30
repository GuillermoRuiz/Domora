import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Contenedor de una sección del panel (gráfico, listado, tabla): cabecera con
 * título, un enlace de acción opcional ("Ver todos →") y el contenido
 * proyectado. `padded=false` deja que tablas y listas lleguen al borde.
 */
@Component({
  selector: 'app-section-card',
  standalone: true,
  imports: [IconComponent],
  template: `
    <section class="section-card">
      <header class="section-card__header">
        <h3 class="section-card__title">{{ title }}</h3>
        <div class="section-card__tools">
          <ng-content select="[slot=tools]"></ng-content>
          @if (actionLabel) {
            <button type="button" class="section-card__action" (click)="action.emit()">
              {{ actionLabel }}
              <app-icon name="arrow-right" [size]="13"></app-icon>
            </button>
          }
        </div>
      </header>
      <div class="section-card__body" [class.section-card__body--padded]="padded">
        <ng-content></ng-content>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .section-card {
      height: 100%;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .section-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px 0;
    }
    .section-card__title { margin: 0; font-size: 15px; font-weight: 700; color: var(--color-text); }
    .section-card__tools { display: flex; align-items: center; gap: 12px; }
    .section-card__action {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: none;
      padding: 0;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--color-accent);
      cursor: pointer;
    }
    .section-card__action:hover { color: var(--color-accent-hover); }
    .section-card__action:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: 4px; }
    .section-card__body--padded { padding: 16px 20px 20px; }
  `],
})
export class SectionCardComponent {
  @Input() title = '';
  /** Texto del enlace de la cabecera; sin él no se pinta. */
  @Input() actionLabel = '';
  @Input() padded = true;
  @Output() action = new EventEmitter<void>();
}
