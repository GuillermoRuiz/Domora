import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  standalone: true,
  template: `
    <div class="progress-bar" [style.height.px]="height">
      <div class="progress-bar__fill" [style.width.%]="clampedValue" [style.background]="color"></div>
    </div>
  `,
  styles: [`
    .progress-bar {
      width: 100%;
      background: var(--color-border-light);
      border-radius: 100px;
      overflow: hidden;
    }
    .progress-bar__fill {
      height: 100%;
      border-radius: 100px;
      background: var(--color-secondary);
      transition: width 0.3s ease;
    }
  `]
})
export class ProgressBarComponent {
  @Input() value = 0;
  @Input() max = 100;
  @Input() height = 6;
  @Input() color = '';

  get clampedValue(): number {
    if (this.max === 0) return 0;
    return Math.min(100, Math.max(0, (this.value / this.max) * 100));
  }
}
