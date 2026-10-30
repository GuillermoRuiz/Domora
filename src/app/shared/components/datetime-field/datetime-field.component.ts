import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnDestroy,
  Output,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

let nextId = 0;

/**
 * `1830` → `18:30`; solo dígitos, máximo 4. Los valores fuera de rango se ajustan al máximo
 * en cuanto se escriben: horas > 23 → `23`, minutos > 59 → `59` (`9219` → `23:19`, `1875` → `18:59`).
 */
export function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  const hours = d.length >= 2 ? String(Math.min(Number(d.slice(0, 2)), 23)).padStart(2, '0') : d;
  if (d.length <= 2) return hours;
  const minutes = d.length === 4 ? String(Math.min(Number(d.slice(2)), 59)).padStart(2, '0') : d.slice(2);
  return `${hours}:${minutes}`;
}

/** `HH:mm` (24 h) → mismo texto si es válido; si no, `''`. */
export function parseTime(text: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? text : '';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` de una fecha local. */
export function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` → fecha local (medianoche), sin desfases de zona horaria. */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `YYYY-MM-DD` → `dd/mm/aaaa` (formato español, sea cual sea el idioma del navegador). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

export interface CalendarCell {
  iso: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  /** "15 de enero de 2027", para lectores de pantalla. */
  label: string;
}

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const monthFormat = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/** Las semanas (de lunes a domingo) necesarias para cubrir el mes: 4, 5 o 6 filas. */
export function buildMonth(year: number, month: number, todayIso: string): CalendarCell[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + days) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(year, month, 1 - offset + i);
    const iso = toIso(date);
    return {
      iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      today: iso === todayIso,
      label: longDateFormat.format(date),
    };
  });
}

/**
 * Fecha y hora: la fecha se elige en un popover con calendario (que se cierra al elegir el día) y la hora
 * se escribe en su propio campo (`hh:mm`, 24 h). Es el campo de las convocatorias de las juntas y de las
 * tareas. Emite `YYYY-MM-DDTHH:mm` (como el `datetime-local` original), y `''` mientras falte o sea inválida
 * alguna parte. Con `dateOnly` no hay hora: emite `YYYY-MM-DD`.
 */
@Component({
  selector: 'app-datetime-field',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './datetime-field.component.html',
  styleUrl: './datetime-field.component.scss',
  host: { '(keydown.escape)': 'onEscape($event)' },
})
export class DatetimeFieldComponent implements OnDestroy {
  @Input({ required: true }) label!: string;
  @Input() invalid = false;
  /** Solo fecha (tareas de «todo el día»): sin campo de hora, emite `YYYY-MM-DD`. */
  @Input() dateOnly = false;
  /** Texto de ayuda bajo el campo (p. ej. "Sugerida…"). */
  @Input() hint: string | null = null;
  /** `id` de un elemento (p. ej. el mensaje de error del wizard) que describe el campo. */
  @Input() describedBy: string | null = null;

  @Input()
  set value(value: string) {
    // No pisar lo que el usuario está escribiendo: solo sincronizar cambios externos.
    if (value === this.lastEmitted) return;
    this.lastEmitted = value;
    const [date = '', time = ''] = value.split('T');
    this.dateIso.set(date);
    this.timeText.set(time.slice(0, 5));
  }
  @Output() valueChange = new EventEmitter<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly popover = viewChild<ElementRef<HTMLElement>>('popover');
  private readonly row = viewChild<ElementRef<HTMLElement>>('row');

  readonly id = `dtf-${++nextId}`;
  /** `YYYY-MM-DD` o vacío. */
  readonly dateIso = signal('');
  readonly timeText = signal('');
  readonly dateText = computed(() => formatDate(this.dateIso()));
  readonly dateLabel = computed(() => {
    const iso = this.dateIso();
    return iso ? longDateFormat.format(fromIso(iso)) : 'sin seleccionar';
  });
  private lastEmitted = '';

  // ── Popover ──
  readonly open = signal(false);
  readonly view = signal({ year: new Date().getFullYear(), month: new Date().getMonth() });
  /** Día con el foco del teclado dentro del calendario (roving tabindex). */
  readonly focusIso = signal('');
  readonly position = signal<{ left: number; top: number }>({ left: 0, top: 0 });
  private opener: HTMLElement | null = null;
  private stopListening: (() => void) | null = null;

  readonly weekdays = WEEKDAY_LABELS;
  readonly monthLabel = computed(() => {
    const { year, month } = this.view();
    const text = monthFormat.format(new Date(year, month, 1));
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  readonly cells = computed(() => buildMonth(this.view().year, this.view().month, toIso(new Date())));

  ngOnDestroy(): void {
    this.stopListening?.();
  }

  // ── Hora ──

  onTimeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const masked = maskTime(input.value);
    input.value = masked;
    this.timeText.set(masked);
    this.emit();
  }

  // ── Apertura / cierre ──

  openPopover(opener: HTMLElement): void {
    if (this.open()) return this.close();
    this.opener = opener;
    const selected = this.dateIso();
    const base = selected ? fromIso(selected) : new Date();
    this.view.set({ year: base.getFullYear(), month: base.getMonth() });
    this.focusIso.set(selected || toIso(new Date()));
    this.open.set(true);
    this.listen();
    afterNextRender(
      () => {
        this.reposition();
        this.popover()?.nativeElement.querySelector<HTMLElement>('[data-day][tabindex="0"]')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  close(restoreFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    this.stopListening?.();
    this.stopListening = null;
    if (restoreFocus) this.opener?.focus();
    this.opener = null;
  }

  onEscape(event: Event): void {
    if (!this.open()) return;
    // Cierra solo el popover: el wizard ignora los Escape ya gestionados.
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  private listen(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (!this.host.nativeElement.contains(e.target as Node)) this.close(false);
    };
    const onScroll = () => this.reposition();
    const onResize = () => this.close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    this.stopListening = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }

  /** Bajo el campo; si no cabe, encima. Siempre dentro del viewport. */
  private reposition(): void {
    const row = this.row()?.nativeElement;
    const popover = this.popover()?.nativeElement;
    if (!row || !popover) return;
    const margin = 12;
    const rect = row.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - margin ? below : Math.max(margin, rect.top - 8 - height);
    this.position.set({ left, top });
  }

  // ── Calendario ──

  shiftMonth(delta: number): void {
    const { year, month } = this.view();
    const next = new Date(year, month + delta, 1);
    this.view.set({ year: next.getFullYear(), month: next.getMonth() });
    // El foco del teclado sigue en el mismo día del mes nuevo (acotado a su último día).
    const current = this.focusIso() ? fromIso(this.focusIso()) : new Date();
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    this.focusIso.set(toIso(new Date(next.getFullYear(), next.getMonth(), Math.min(current.getDate(), last))));
  }

  /** Elegir el día cierra el popover (y devuelve el foco al botón de fecha). */
  selectDay(iso: string): void {
    this.dateIso.set(iso);
    this.focusIso.set(iso);
    this.emit();
    this.close();
  }

  /**
   * Flechas: ±1 día / ±1 semana · Inicio/Fin: lunes/domingo de la semana ·
   * RePág/AvPág: ±1 mes (con Mayús, ±1 año).
   */
  onDayKeydown(event: KeyboardEvent): void {
    // Se parte del estado (no del botón con foco): con pulsaciones seguidas el foco aún puede ir un render por detrás.
    const date = fromIso(this.focusIso() || toIso(new Date()));
    const weekday = (date.getDay() + 6) % 7;
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    };
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const months = (event.shiftKey ? 12 : 1) * (event.key === 'PageUp' ? -1 : 1);
      this.shiftMonth(months);
      this.focusDay(this.focusIso());
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    date.setDate(date.getDate() + moves[event.key]);
    this.focusIso.set(toIso(date));
    this.view.set({ year: date.getFullYear(), month: date.getMonth() });
    this.focusDay(this.focusIso());
  }

  /** Foco inmediato si el día ya está pintado; si cambió el mes, en cuanto se renderice. */
  private focusDay(iso: string): void {
    const find = () => this.popover()?.nativeElement.querySelector<HTMLElement>(`[data-iso="${iso}"]`);
    const now = find();
    if (now) {
      now.focus({ preventScroll: true });
      return;
    }
    afterNextRender(() => find()?.focus({ preventScroll: true }), { injector: this.injector });
  }

  private emit(): void {
    const date = this.dateIso();
    const time = parseTime(this.timeText());
    const value = this.dateOnly ? date : date && time ? `${date}T${time}` : '';
    this.lastEmitted = value;
    this.valueChange.emit(value);
  }
}
