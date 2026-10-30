import { Component, Input } from '@angular/core';
import type { Tone } from './meeting-workspace.model';

/** Pill de estado: el color siempre va acompañado de texto, nunca comunica por sí solo. */
@Component({
  selector: 'app-status-pill',
  standalone: true,
  template: `<span class="pill" [class]="'pill pill--' + tone"
    >@if (dot) {<span class="pill__dot" aria-hidden="true"></span>}<ng-content></ng-content
  ></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.3;
        white-space: nowrap;
      }
      .pill__dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }
      .pill--green {
        color: var(--meeting-green, var(--color-secondary));
        background: color-mix(in srgb, var(--meeting-green, var(--color-secondary)) 14%, transparent);
      }
      .pill--yellow {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 14%, transparent);
      }
      .pill--red {
        color: var(--color-error);
        background: color-mix(in srgb, var(--color-error) 14%, transparent);
      }
      .pill--blue {
        color: var(--color-blue);
        background: color-mix(in srgb, var(--color-blue) 14%, transparent);
        border-color: color-mix(in srgb, var(--color-blue) 35%, transparent);
      }
      .pill--muted {
        color: var(--color-muted);
        background: var(--color-border-light);
      }
    `,
  ],
})
export class StatusPillComponent {
  @Input() tone: Tone = 'muted';
  @Input() dot = true;
}
