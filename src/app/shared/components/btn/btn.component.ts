import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-btn',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      class="btn"
      [class]="'btn btn--' + variant + (size ? ' btn--' + size : '') + (block ? ' btn--block' : '')"
      [disabled]="disabled"
      (click)="clicked.emit($event)"
      [type]="type"
    >
      <ng-content></ng-content>
    </button>
  `,
  styles: [`
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 15px;
      font-weight: 500;
      font-family: var(--font-family);
      cursor: pointer;
      border: none;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn--primary { background: var(--color-primary); color: #fff; border: 1px solid var(--color-accent); }
    .btn--primary:hover:not(:disabled) { background: var(--color-primary-hover); }
    .btn--secondary { background: var(--color-secondary); color: #fff; }
    .btn--secondary:hover:not(:disabled) { background: var(--color-secondary-hover); }
    .btn--outline { background: transparent; color: var(--color-text); border: 1px solid var(--color-border); }
    .btn--outline:hover:not(:disabled) { background: var(--color-bg); }
    .btn--ghost { background: transparent; color: var(--color-muted); }
    .btn--ghost:hover:not(:disabled) { background: var(--color-border-light); color: var(--color-text); }
    .btn--danger { background: var(--color-error-bg); color: var(--color-error); }
    .btn--danger:hover:not(:disabled) { background: var(--color-error-border); }
    .btn--accent { background: var(--color-accent); color: #14120a; border: 1px solid var(--color-accent); font-weight: 600; }
    .btn--accent:hover:not(:disabled) { background: var(--color-accent-hover); border-color: var(--color-accent-hover); }
    :host-context([data-theme='light']) .btn--accent { color: #fff; }
    .btn--subtle { background: var(--color-surface-hover); color: var(--color-text); border: 1px solid var(--color-border-light); }
    .btn--subtle:hover:not(:disabled) { border-color: var(--color-border); }
    .btn--block { width: 100%; justify-content: center; }
    .btn--sm { padding: 5px 12px; font-size: 14px; }
    .btn--lg { padding: 10px 20px; font-size: 16px; }
    .btn--icon { padding: 6px; border-radius: var(--radius-sm); }
  `]
})
export class BtnComponent {
  @Input() variant: 'primary' | 'accent' | 'subtle' | 'secondary' | 'outline' | 'ghost' | 'danger' = 'primary';
  @Input() size: 'sm' | 'lg' | 'icon' | '' = '';
  @Input() disabled = false;
  @Input() block = false;
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Output() clicked = new EventEmitter<MouseEvent>();
}
