import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-toggle',
  standalone: true,
  template: `
    <button
      class="toggle"
      [class.toggle--on]="on"
      [class.toggle--choice]="variant === 'choice'"
      [disabled]="disabled"
      role="switch"
      [attr.aria-checked]="on"
      [attr.aria-label]="label || null"
      (click)="onChange.emit(!on)"
      type="button"
    >
      <span class="toggle__knob"></span>
    </button>
  `,
  styles: [`
    .toggle {
      width: 38px;
      height: 20px;
      border-radius: 10px;
      border: none;
      padding: 2px;
      background: var(--color-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .toggle:disabled { opacity: 0.6; cursor: not-allowed; }
    .toggle--on { background: var(--color-secondary); }
    /* Elegir entre dos opciones: verde en las dos posiciones (ninguna es «apagado»). */
    .toggle--choice, .toggle--choice.toggle--on { background: var(--meeting-green, #3fa372); }
    .toggle__knob {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--color-surface);
      box-shadow: 0 1px 3px rgba(0,0,0,0.18);
      transition: transform 0.2s;
    }
    .toggle--on .toggle__knob { transform: translateX(18px); }
  `]
})
export class ToggleComponent {
  @Input() on = false;
  @Input() disabled = false;
  /** `choice`: verde en las dos posiciones, para elegir entre dos opciones y no encender/apagar algo. */
  @Input() variant: 'default' | 'choice' = 'default';
  /** Nombre accesible del interruptor. */
  @Input() label = '';
  @Output() onChange = new EventEmitter<boolean>();
}
