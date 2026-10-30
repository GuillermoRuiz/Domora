import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-badge',
  standalone: true,
  template: `<span class="badge" [class]="'badge--' + variant">{{ text }}</span>`,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .badge--default { background: var(--color-border-light); color: var(--color-muted); }
    .badge--green { background: var(--color-tertiary-bg); color: var(--color-tertiary); }
    .badge--error { background: var(--color-error-bg); color: var(--color-error); }
    .badge--warning { background: var(--color-warning-bg); color: var(--color-warning); }
    .badge--primary { background: var(--color-primary); color: #fff; border: 1px solid var(--color-accent); }
    .badge--nav { background: var(--color-error); color: #fff; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; justify-content: center; }
  `]
})
export class BadgeComponent {
  @Input() text: string | number | null = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Input() variant: string = 'default';
}
