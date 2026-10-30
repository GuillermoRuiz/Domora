import { Component, computed, input } from '@angular/core';
import { linePath } from './chart-math';

const PAD = 2;

/**
 * Tiny trend line for a KPI tile: min-max scaled, no axes, decorative
 * (`aria-hidden`): the figure and its variation next to it carry the data.
 * Nothing is drawn with fewer than two values.
 */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  template: `
    @if (path(); as d) {
      <svg class="sparkline" [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="'0 0 ' + width() + ' ' + height()" aria-hidden="true" focusable="false">
        <path class="sparkline__line" [attr.d]="d" />
      </svg>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .sparkline { display: block; overflow: visible; }
    .sparkline__line { fill: none; stroke: var(--sparkline-color, var(--chart-1)); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  `],
})
export class SparklineComponent {
  readonly values = input.required<number[]>();
  readonly width = input(96);
  readonly height = input(28);

  readonly path = computed(() => {
    const values = this.values();
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = this.width() - PAD * 2;
    const h = this.height() - PAD * 2;
    return linePath(values.map((v, i) => ({
      x: PAD + (i * w) / (values.length - 1),
      y: max === min ? this.height() / 2 : PAD + (1 - (v - min) / (max - min)) * h,
    })));
  });
}
