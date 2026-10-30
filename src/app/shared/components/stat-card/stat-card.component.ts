import { Component, Input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { SparklineComponent } from '../charts/sparkline.component';
import { InfoTipComponent } from './info-tip.component';

export type StatChangeTone = 'positive' | 'danger' | 'neutral';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [IconComponent, InfoTipComponent, SparklineComponent],
  template: `
    <div class="stat-card" [class.stat-card--accent]="accent">
      <div class="stat-card__header">
        <span class="stat-card__label">
          {{ label }}
          @if (info) {
            <app-info-tip class="stat-card__info" [text]="info" [label]="'Cómo se calcula «' + label + '»'"></app-info-tip>
          }
        </span>
        @if (icon) {
          <div class="stat-card__icon">
            <app-icon [name]="icon" [size]="16"></app-icon>
          </div>
        }
      </div>
      @if (trend) {
        <div class="stat-card__figure">
          <div class="stat-card__value">{{ value }}</div>
          <app-sparkline class="stat-card__trend" [values]="trend" [width]="88" [height]="28"></app-sparkline>
        </div>
      } @else {
        <div class="stat-card__value">{{ value }}</div>
      }
      @if (change) {
        <div class="stat-card__change" [class]="'stat-card__change stat-card__change--' + changeTone">{{ change }}</div>
      }
      @if (sub) {
        <div class="stat-card__sub">{{ sub }}</div>
      }
    </div>
  `,
  styles: [`
    .stat-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .stat-card--accent {
      background: var(--color-primary);
      border-color: var(--color-accent);
      color: #fff;
    }
    .stat-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .stat-card__label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-muted);
    }
    .stat-card--accent .stat-card__label { color: rgba(255,255,255,0.7); }
    .stat-card__icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-bg);
      border-radius: var(--radius-sm);
      color: var(--color-muted);
    }
    .stat-card--accent .stat-card__icon { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); }
    .stat-card__value {
      font-size: 29px;
      font-weight: 700;
      line-height: 1;
    }
    .stat-card__figure { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; min-width: 0; }
    .stat-card__trend { flex-shrink: 0; }
    .stat-card__change { font-size: 13px; font-weight: 600; color: var(--color-muted); }
    .stat-card__change--positive { color: var(--color-success); }
    .stat-card__change--danger { color: var(--color-error); }
    .stat-card__sub {
      font-size: 13px;
      color: var(--color-muted);
    }
    .stat-card--accent .stat-card__sub { color: rgba(255,255,255,0.65); }
  `]
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number | null = '';
  @Input() sub = '';
  @Input() icon = '';
  @Input() accent = false;
  /** How the figure is calculated: shown by an «i» next to the label (hover, focus or tap). */
  @Input() info = '';
  /** Variation line under the figure, e.g. «+12,5 % vs. mes anterior». */
  @Input() change = '';
  @Input() changeTone: StatChangeTone = 'neutral';
  /** Values of a sparkline next to the figure; null = none. */
  @Input() trend: number[] | null = null;
}
