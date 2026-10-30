import { Component, ElementRef, HostListener, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import {
  DateRange, addDays, addMonths, buildMonthGrid, formatDay, formatRange, fromIsoDate, monthLabel, orderRange, presetRanges, toIsoDate,
} from './date-range.util';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Selector de rango de fechas: un botón que abre un calendario mensual. Se elige el primer día y después
 * el último (o un atajo); al completar el rango se emite `valueChange` y se cierra. `null` = sin rango.
 * Teclado: flechas mueven el día, RePág/AvPág cambian de mes, Intro/Espacio eligen y Esc cierra.
 */
@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './date-range-picker.component.html',
  styleUrl: './date-range-picker.component.scss',
})
export class DateRangePickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  readonly value = input<DateRange | null>(null);
  readonly placeholder = input('Fecha: todas');
  readonly label = input('Rango de fechas');
  readonly valueChange = output<DateRange | null>();

  readonly open = signal(false);
  readonly weekdays = WEEKDAYS;
  readonly today = toIsoDate(new Date());
  readonly presets = computed(() => presetRanges());
  private readonly viewDay = signal(this.today);
  private readonly pendingStart = signal<string | null>(null);
  private readonly hoverDay = signal<string | null>(null);
  private readonly focusDay = signal(this.today);

  readonly weeks = computed(() => buildMonthGrid(this.viewDay()));
  readonly title = computed(() => monthLabel(this.viewDay()));
  readonly triggerText = computed(() => { const range = this.value(); return range ? formatRange(range) : this.placeholder(); });
  /** Rango pintado: el que se está eligiendo (con vista previa al pasar el ratón) o el aplicado. */
  readonly shown = computed<DateRange | null>(() => {
    const start = this.pendingStart();
    return start ? orderRange(start, this.hoverDay() ?? start) : this.value();
  });
  readonly hint = computed(() => {
    const start = this.pendingStart();
    if (start) return `Desde ${formatDay(start, true)} · elige el último día`;
    const range = this.value();
    return range ? formatRange(range) : 'Elige el primer día';
  });

  toggle(): void { if (this.open()) this.close(true); else this.openPanel(); }

  private openPanel(): void {
    const anchor = this.value()?.from ?? toIsoDate(new Date());
    this.viewDay.set(anchor); this.focusDay.set(anchor);
    this.pendingStart.set(null); this.hoverDay.set(null);
    this.open.set(true);
    this.focusActiveDay();
  }

  close(returnFocus = false): void {
    if (!this.open()) return;
    this.open.set(false); this.pendingStart.set(null); this.hoverDay.set(null);
    if (returnFocus) this.host.querySelector<HTMLElement>('.drp__trigger')?.focus();
  }

  shiftMonth(delta: number): void {
    this.viewDay.update(iso => addMonths(iso, delta));
    this.focusDay.update(iso => addMonths(iso, delta));
  }

  select(iso: string): void {
    const start = this.pendingStart();
    if (!start) { this.pendingStart.set(iso); this.hoverDay.set(iso); this.focusDay.set(iso); return; }
    this.valueChange.emit(orderRange(start, iso));
    this.close(true);
  }

  applyPreset(range: DateRange): void { this.valueChange.emit(range); this.close(true); }
  clear(): void { this.valueChange.emit(null); this.close(true); }

  hover(iso: string): void { if (this.pendingStart()) this.hoverDay.set(iso); }
  tabIndex(iso: string): number { return this.focusDay() === iso ? 0 : -1; }
  dayLabel(iso: string): string {
    return fromIsoDate(iso)?.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) ?? iso;
  }

  isStart(iso: string): boolean { return this.shown()?.from === iso; }
  isEnd(iso: string): boolean { return this.shown()?.to === iso; }
  isMiddle(iso: string): boolean { const r = this.shown(); return !!r && iso > r.from && iso < r.to; }
  isPresetActive(range: DateRange): boolean { const v = this.value(); return !!v && v.from === range.from && v.to === range.to; }

  onDayKeydown(event: KeyboardEvent, iso: string): void {
    const moves: Record<string, string> = {
      ArrowLeft: addDays(iso, -1), ArrowRight: addDays(iso, 1), ArrowUp: addDays(iso, -7), ArrowDown: addDays(iso, 7),
      PageUp: addMonths(iso, -1), PageDown: addMonths(iso, 1),
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    this.focusDay.set(next); this.hover(next);
    if (next.slice(0, 7) !== this.viewDay().slice(0, 7)) this.viewDay.set(next);
    this.focusActiveDay();
  }

  private focusActiveDay(): void {
    afterNextRender({ write: () => this.host.querySelector<HTMLElement>('.drp__day[tabindex="0"]')?.focus() }, { injector: this.injector });
  }

  @HostListener('document:click', ['$event']) onDocumentClick(event: Event): void {
    if (this.open() && !this.host.contains(event.target as Node)) this.close();
  }
  @HostListener('document:keydown.escape') onEscape(): void { this.close(true); }
}
