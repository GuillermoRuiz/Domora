import { Component, input } from '@angular/core';

/**
 * «En riesgo» tag (odd/tasks/role-a-panel.md S14): a flag, never a client
 * status. The motive shows on hover and on keyboard focus (and on tap,
 * which focuses the tag), and is also part of its accessible name.
 */
@Component({
  selector: 'app-risk-tag',
  standalone: true,
  template: `
    <span class="risk-tag" tabindex="0" [attr.aria-label]="motivo() ? 'En riesgo: ' + motivo() : 'En riesgo'">
      En riesgo
      @if (motivo()) { <span class="risk-tag__tip" role="tooltip">Motivo: {{ motivo() }}</span> }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .risk-tag {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--color-error-bg);
      color: var(--color-error);
      cursor: help;
      outline: none;
    }
    .risk-tag:focus-visible { box-shadow: 0 0 0 2px var(--color-accent); }
    .risk-tag__tip {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      padding: 6px 10px;
      border-radius: var(--radius-md);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      font-weight: 500;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
      visibility: hidden;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .risk-tag:hover .risk-tag__tip,
    .risk-tag:focus .risk-tag__tip { visibility: visible; opacity: 1; }
  `],
})
export class RiskTagComponent {
  readonly motivo = input<string | null | undefined>(null);
}
