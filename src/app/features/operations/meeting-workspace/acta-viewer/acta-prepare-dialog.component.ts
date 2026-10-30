import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import type { ActaValidation, GenerateActaPayload } from '../../../../core/acta.models';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `HH:mm` en la zona horaria del navegador. */
export function toTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO del día `base` a la hora `HH:mm` (en la zona horaria del navegador). */
export function toIso(base: Date, time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number(match[1]), Number(match[2]), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Pequeña etapa previa a generar el acta: la gestora confirma los datos reales de la reunión que
 * Domora no puede deducir (hora de inicio, hora de fin y convocatoria en la que se constituyó).
 * Llega rellenado: la hora de inicio es la de la convocatoria elegida (se actualiza al cambiar de
 * convocatoria mientras no se haya tocado) y la de fin, la hora en que se marcó como celebrada.
 * Lo que la gestora ya confirmó antes tiene prioridad sobre esos valores.
 */
@Component({
  selector: 'app-acta-prepare-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, ToggleComponent, SelectDropdownDirective],
  templateUrl: './acta-prepare-dialog.component.html',
  styleUrl: './acta-prepare-dialog.component.scss',
})
export class ActaPrepareDialogComponent implements OnInit, OnDestroy {
  @Input({ required: true }) validation!: ActaValidation;
  @Input() busy = false;
  /** Error devuelto al intentar generar. */
  @Input() error = '';
  @Output() generate = new EventEmitter<GenerateActaPayload>();
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly startTime = signal('');
  readonly endTime = signal('');
  readonly convocation = signal<'primera' | 'segunda'>('primera');
  readonly time = toTimeInput;
  /** Horas (00–23) y minutos (00–59) de los desplegables. */
  readonly hours = Array.from({ length: 24 }, (_, i) => pad(i));
  readonly minutes = Array.from({ length: 60 }, (_, i) => pad(i));

  /** `HH` o `mm` de una hora `HH:mm` (vacío si no hay hora). */
  part(time: string, which: 'hour' | 'minute'): string {
    const [hour = '', minute = ''] = time.split(':');
    return which === 'hour' ? hour : minute;
  }

  /** Cambia solo la hora o solo los minutos; con una parte vacía se completa con `00`. */
  setPart(target: 'start' | 'end', which: 'hour' | 'minute', value: string): void {
    const current = target === 'start' ? this.startTime() : this.endTime();
    const hour = which === 'hour' ? value : this.part(current, 'hour') || '00';
    const minute = which === 'minute' ? value : this.part(current, 'minute') || '00';
    (target === 'start' ? this.startTime : this.endTime).set(`${hour}:${minute}`);
  }

  /** Errores que no son un dato pendiente de este formulario (junta sin celebrar, votaciones abiertas…). */
  get blockingIssues() {
    return this.validation.errors.filter((issue) => !issue.field && issue.code !== 'TIME_ORDER');
  }
  get timeOrderIssue() {
    return this.validation.errors.find((issue) => issue.code === 'TIME_ORDER');
  }

  readonly invalidOrder = computed(() => {
    const start = this.startTime();
    const end = this.endTime();
    return !!start && !!end && end <= start;
  });

  get complete(): boolean {
    return !!this.startTime() && !!this.endTime() && !this.invalidOrder();
  }

  get canGenerate(): boolean {
    return this.complete && this.blockingIssues.length === 0 && !this.busy;
  }

  /** Hora de la convocatoria indicada: la que se propone como hora de inicio. */
  referenceStart(convocation: 'primera' | 'segunda'): string {
    const { scheduledAt1, scheduledAt2 } = this.validation.reference;
    return toTimeInput(convocation === 'segunda' ? scheduledAt2 : scheduledAt1);
  }

  /** Hora a la que se marcó la junta como celebrada: la que se propone como hora de fin. */
  get endSuggestion(): string {
    return toTimeInput(this.validation.reference.celebratedAt);
  }

  constructor() {
    inject(DOCUMENT).body.appendChild(this.host.nativeElement);
  }

  ngOnInit(): void {
    const confirmed = this.validation.confirmed;
    const convocation = confirmed.effectiveConvocation ?? 'primera';
    this.convocation.set(convocation);
    this.startTime.set(toTimeInput(confirmed.actualStartAt) || this.referenceStart(convocation));
    this.endTime.set(toTimeInput(confirmed.actualEndAt) || this.endSuggestion);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  /** Cambia de convocatoria; la hora de inicio acompaña a la de la convocatoria si no se ha cambiado a mano. */
  setConvocation(convocation: 'primera' | 'segunda'): void {
    if (convocation === this.convocation()) return;
    const previous = this.referenceStart(this.convocation());
    this.convocation.set(convocation);
    if (!this.startTime() || this.startTime() === previous) this.startTime.set(this.referenceStart(convocation));
  }

  submit(): void {
    if (!this.canGenerate) return;
    // El día de la reunión es el de la convocatoria elegida; la hora la confirma la gestora.
    const { scheduledAt1, scheduledAt2 } = this.validation.reference;
    const base = new Date(this.validation.confirmed.actualStartAt ?? (this.convocation() === 'segunda' ? scheduledAt2 : scheduledAt1));
    const payload: GenerateActaPayload = {
      actualStartAt: toIso(base, this.startTime()) ?? undefined,
      actualEndAt: toIso(base, this.endTime()) ?? undefined,
      effectiveConvocation: this.convocation(),
    };
    this.generate.emit(payload);
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }
}
