import { Component, Input } from '@angular/core';

export type StatusTone = 'positive' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Estado compacto de una fila: "Al día", "Con incidencias", "Próximo",
 * "Programado". El tono lo decide quien la usa; el color nunca es el único
 * portador del significado (siempre lleva texto).
 */
@Component({
  selector: 'app-status-pill',
  standalone: true,
  template: `
    <span class="pill" [class]="'pill--' + tone">
      @if (dot) { <span class="pill__dot" aria-hidden="true"></span> }
      {{ text }}
    </span>
  `,
  styles: [`
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .pill__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .pill--positive { background: var(--color-success-bg); color: var(--color-success); }
    .pill--danger { background: var(--color-error-bg); color: var(--color-error); }
    .pill--warning { background: var(--color-warning-bg); color: var(--color-warning); }
    .pill--info { background: color-mix(in srgb, var(--color-accent) 18%, transparent); color: var(--color-accent); }
    .pill--neutral { background: var(--color-border-light); color: var(--color-muted); }
  `],
})
export class StatusPillComponent {
  @Input() text = '';
  @Input() tone: StatusTone = 'neutral';
  /** Punto de color delante del texto (estados de fila). */
  @Input() dot = false;
}
