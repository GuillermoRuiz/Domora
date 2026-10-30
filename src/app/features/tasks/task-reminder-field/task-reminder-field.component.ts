import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { REMINDER_PRESETS } from '../../../core/agenda-tasks.model';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const MAX_MINUTES = 7 * 24 * 60;
type Unit = 'm' | 'h' | 'd';
const UNIT_MINUTES: Record<Unit, number> = { m: 1, h: 60, d: 1440 };

/**
 * Selector de recordatorio. Los valores predefinidos son minutos de
 * antelación (0 = en el momento); "Personalizado" admite cualquier cantidad
 * hasta 7 días. `null` = sin recordatorio.
 */
@Component({
  selector: 'app-task-reminder-field',
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective],
  template: `
    <div class="reminder">
      <select class="reminder__select" [attr.aria-label]="ariaLabel()" [ngModel]="selectValue()" (ngModelChange)="onSelect($event)">
        @for (preset of presets; track preset.label) {
          <option [value]="preset.value === null ? 'none' : '' + preset.value">{{ preset.label }}</option>
        }
        <option value="custom">Personalizado…</option>
      </select>
      @if (selectValue() === 'custom') {
        <div class="reminder__custom">
          <input type="number" min="1" step="1" aria-label="Cantidad de antelación" [ngModel]="customAmount()" (ngModelChange)="onAmount($event)" />
          <select aria-label="Unidad de antelación" [ngModel]="customUnit()" (ngModelChange)="onUnit($event)">
            <option value="m">minutos</option>
            <option value="h">horas</option>
            <option value="d">días</option>
          </select>
          <span class="reminder__hint">antes</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .reminder { display: flex; flex-direction: column; gap: 6px; }
    .reminder__custom { display: flex; align-items: center; gap: 6px; }
    .reminder__custom input { width: 80px; }
    .reminder__hint { font-size: 13px; color: var(--color-muted); }
  `],
})
export class TaskReminderFieldComponent {
  readonly value = input<number | null>(null);
  readonly ariaLabel = input('Recordatorio');
  readonly valueChange = output<number | null>();

  readonly presets = REMINDER_PRESETS;
  private readonly customMode = signal(false);

  private readonly isPreset = computed(() => {
    const v = this.value();
    return v === null || this.presets.some((p) => p.value === v);
  });

  readonly selectValue = computed(() => {
    const v = this.value();
    if (this.customMode() || !this.isPreset()) return 'custom';
    return v === null ? 'none' : String(v);
  });

  /** Unidad "natural" del valor actual: 1440 → días, 120 → horas, 45 → minutos. */
  readonly customUnit = computed<Unit>(() => {
    const v = this.value() ?? 0;
    if (v > 0 && v % 1440 === 0) return 'd';
    if (v > 0 && v % 60 === 0) return 'h';
    return 'm';
  });

  readonly customAmount = computed(() => {
    const v = this.value() ?? 0;
    return v / UNIT_MINUTES[this.customUnit()];
  });

  onSelect(choice: string): void {
    if (choice === 'custom') {
      this.customMode.set(true);
      this.valueChange.emit(this.value() ?? 60);
      return;
    }
    this.customMode.set(false);
    this.valueChange.emit(choice === 'none' ? null : Number(choice));
  }

  onAmount(amount: number | null): void {
    this.emitMinutes(Number(amount), this.customUnit());
  }

  onUnit(unit: Unit): void {
    this.emitMinutes(this.customAmount() || 1, unit);
  }

  private emitMinutes(amount: number, unit: Unit): void {
    const minutes = Math.round(amount) * UNIT_MINUTES[unit];
    if (!Number.isFinite(minutes) || minutes < 1) return;
    this.valueChange.emit(Math.min(minutes, MAX_MINUTES));
  }
}
