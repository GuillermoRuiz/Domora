import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgendaRecurrenceFreq, RECURRENCE_UNITS, TaskRecurrence } from '../../../core/agenda-tasks.model';
import { dateKey } from '../tasks.util';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
type Choice = 'none' | AgendaRecurrenceFreq | 'custom';

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'none', label: 'No se repite' },
  { value: 'DAILY', label: 'Cada día' },
  { value: 'WEEKLY', label: 'Cada semana' },
  { value: 'MONTHLY', label: 'Cada mes' },
  { value: 'YEARLY', label: 'Cada año' },
  { value: 'custom', label: 'Personalizado…' },
];

/**
 * Repetición de una tarea. Una serie es UNA tarea con regla (frecuencia +
 * intervalo + fin opcional); sus ocurrencias las calcula el servidor al
 * consultar, no se guardan una a una.
 */
@Component({
  selector: 'app-task-recurrence-field',
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective],
  template: `
    <div class="recurrence">
      <select class="recurrence__select" aria-label="Repetición" [ngModel]="choice()" (ngModelChange)="onChoice($event)">
        @for (c of choices; track c.value) {
          <option [value]="c.value">{{ c.label }}</option>
        }
      </select>
      @if (choice() === 'custom' && value(); as rule) {
        <div class="recurrence__row">
          <span class="recurrence__hint">Cada</span>
          <input type="number" min="1" max="365" step="1" aria-label="Cada cuántas unidades" [ngModel]="rule.interval" (ngModelChange)="onInterval($event)" />
          <select aria-label="Unidad de repetición" [ngModel]="rule.freq" (ngModelChange)="onFreq($event)">
            @for (u of units; track u.freq) {
              <option [value]="u.freq">{{ rule.interval === 1 ? u.singular : u.plural }}</option>
            }
          </select>
        </div>
      }
      @if (value(); as rule) {
        <label class="recurrence__row recurrence__until">
          <span class="recurrence__hint">Termina el</span>
          <input type="date" aria-label="Fecha de fin de la repetición" [ngModel]="untilInput()" (ngModelChange)="onUntil($event)" />
          <span class="recurrence__hint">(opcional)</span>
        </label>
      }
    </div>
  `,
  styles: [`
    .recurrence { display: flex; flex-direction: column; gap: 6px; }
    .recurrence__row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .recurrence__row input[type='number'] { width: 70px; }
    .recurrence__hint { font-size: 13px; color: var(--color-muted); }
  `],
})
export class TaskRecurrenceFieldComponent {
  readonly value = input<TaskRecurrence | null>(null);
  readonly valueChange = output<TaskRecurrence | null>();

  readonly choices = CHOICES;
  readonly units = (Object.keys(RECURRENCE_UNITS) as AgendaRecurrenceFreq[]).map((freq) => ({ freq, ...RECURRENCE_UNITS[freq] }));
  private readonly customMode = signal(false);

  readonly choice = computed<Choice>(() => {
    const rule = this.value();
    if (!rule) return 'none';
    return this.customMode() || rule.interval !== 1 ? 'custom' : rule.freq;
  });

  readonly untilInput = computed(() => {
    const until = this.value()?.until;
    return until ? dateKey(new Date(until)) : '';
  });

  onChoice(choice: Choice): void {
    if (choice === 'none') {
      this.customMode.set(false);
      this.valueChange.emit(null);
      return;
    }
    const previous = this.value();
    if (choice === 'custom') {
      this.customMode.set(true);
      this.valueChange.emit({ freq: previous?.freq ?? 'WEEKLY', interval: Math.max(2, previous?.interval ?? 2), until: previous?.until ?? null });
      return;
    }
    this.customMode.set(false);
    this.valueChange.emit({ freq: choice, interval: 1, until: previous?.until ?? null });
  }

  onInterval(interval: number | null): void {
    const rule = this.value();
    const n = Math.round(Number(interval));
    if (!rule || !Number.isFinite(n) || n < 1) return;
    this.valueChange.emit({ ...rule, interval: Math.min(n, 365) });
  }

  onFreq(freq: AgendaRecurrenceFreq): void {
    const rule = this.value();
    if (rule) this.valueChange.emit({ ...rule, freq });
  }

  /** El fin es el último instante del día elegido, para que ese día todavía cuente. */
  onUntil(date: string): void {
    const rule = this.value();
    if (!rule) return;
    if (!date) {
      this.valueChange.emit({ ...rule, until: null });
      return;
    }
    const [y, m, d] = date.split('-').map(Number);
    this.valueChange.emit({ ...rule, until: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() });
  }
}
