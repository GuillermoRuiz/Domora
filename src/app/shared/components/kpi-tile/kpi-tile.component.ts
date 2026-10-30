import { Component, Input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type KpiTone = 'default' | 'positive' | 'danger' | 'warning';
export type KpiIconTone = 'accent' | 'error' | 'success' | 'purple' | 'blue';

/**
 * Indicador del panel de la finca: icono a la izquierda, etiqueta, cifra
 * grande y una línea secundaria. `tone` colorea la cifra (saldo positivo,
 * deuda…). Distinto de `app-stat-card` (vertical, usado en los listados).
 */
@Component({
  selector: 'app-kpi-tile',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="kpi" [class]="'kpi--' + tone" [class.kpi--top]="align === 'start'">
      @if (icon) {
        <div class="kpi__icon" [class]="iconTone ? 'kpi__icon kpi__icon--' + iconTone : 'kpi__icon'"><app-icon [name]="icon" [size]="20"></app-icon></div>
      }
      <div class="kpi__body">
        <span class="kpi__label">{{ label }}</span>
        <span class="kpi__value">{{ value }}</span>
        @if (sub) {
          <span class="kpi__sub">{{ sub }}</span>
        }
        @if (progress !== null) {
          <span class="kpi__bar" aria-hidden="true"><span class="kpi__bar-fill" [style.width.%]="progress" [style.background]="progressColor"></span></span>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .kpi {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 100%;
      padding: 14px 16px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
    }
    .kpi--top { align-items: flex-start; }
    .kpi__icon {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-bg);
      border-radius: var(--radius-md);
      color: var(--color-muted);
    }
    .kpi__icon--accent { background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent); }
    .kpi__icon--error { background: var(--color-error-bg); color: var(--color-error); }
    .kpi__icon--success { background: var(--color-success-bg); color: var(--color-success); }
    .kpi__icon--purple { background: var(--color-purple-bg); color: var(--color-purple); }
    .kpi__icon--blue { background: var(--color-blue-bg); color: var(--color-blue); }
    .kpi__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .kpi__label { font-size: 13.5px; font-weight: 500; color: var(--color-muted); }
    .kpi__value {
      font-size: 21px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--color-text);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .kpi__sub { font-size: 13px; color: var(--color-muted); }
    .kpi__bar { display: block; height: 4px; margin-top: 6px; background: var(--color-border-light); border-radius: 2px; overflow: hidden; }
    .kpi__bar-fill { display: block; height: 100%; border-radius: 2px; }
    .kpi--positive .kpi__value { color: var(--color-secondary); }
    .kpi--danger .kpi__value { color: var(--color-error); }
    .kpi--warning .kpi__value { color: var(--color-warning); }
  `],
})
export class KpiTileComponent {
  /** Porcentaje (0-100) de una barra fina bajo la cifra; null = sin barra. */
  @Input() progress: number | null = null;
  @Input() progressColor = 'var(--color-accent)';
  /** 'start' alinea icono y texto arriba: así las fichas de una fila coinciden aunque unas lleven barra y otras no. */
  @Input() align: 'center' | 'start' = 'center';
  @Input() label = '';
  @Input() value: string | number | null = '';
  @Input() sub = '';
  @Input() icon = '';
  @Input() tone: KpiTone = 'default';
  /** Tinted icon square; null keeps the neutral icon. */
  @Input() iconTone: KpiIconTone | null = null;
}
