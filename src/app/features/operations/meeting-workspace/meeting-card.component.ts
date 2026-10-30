import { Component, Input } from '@angular/core';

/** Tarjeta oscura con título y metadato opcional a la derecha. Base de todos los bloques del detalle de junta. */
@Component({
  selector: 'app-meeting-card',
  standalone: true,
  template: `
    <section class="mcard" [attr.aria-label]="title">
      @if (title) {
        <header class="mcard__header">
          <h3 class="mcard__title">{{ title }}</h3>
          @if (meta) {
            <span class="mcard__meta">{{ meta }}</span>
          }
          <ng-content select="[card-actions]"></ng-content>
        </header>
      }
      <ng-content></ng-content>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .mcard {
        height: 100%;
        box-sizing: border-box;
        padding: 16px 18px;
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
      }
      .mcard__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      .mcard__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.2px;
      }
      .mcard__meta {
        margin-left: auto;
        color: var(--color-muted);
        font-size: 13px;
        white-space: nowrap;
      }
    `,
  ],
})
export class MeetingCardComponent {
  @Input() title = '';
  @Input() meta = '';
}
