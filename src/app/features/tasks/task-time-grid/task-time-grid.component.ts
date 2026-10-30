import { AfterViewInit, Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AgendaTask, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { DaySegment, WEEKDAY_SHORT, bucketByDay, dateKey, sameDay, startOfDay, timeRangeLabel } from '../tasks.util';

/** Alto de una hora en píxeles: define la escala de TODO el calendario. */
export const HOUR_PX = 52;
const SNAP_MINUTES = 15;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export interface SlotClick {
  date: Date;
  /** Minutos desde las 00:00, ajustados a cuartos de hora. */
  minutes: number;
}

export interface TaskMove {
  task: AgendaTask;
  /** Nuevo inicio (hora local); para tareas de día completo, las 00:00 del día. */
  start: Date;
}

export interface TaskHover {
  task: AgendaTask;
  rect: DOMRect;
}

/**
 * Cuadrícula horaria de las vistas Día y Semana: una columna por día, bloques
 * posicionados por hora y alto proporcional a la duración, y una franja
 * superior "Todo el día". El color de un bloque es SIEMPRE la prioridad; el
 * tipo se ve por el icono y el estado por el tachado/insignia.
 */
@Component({
  selector: 'app-task-time-grid',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './task-time-grid.component.html',
  styleUrl: './task-time-grid.component.scss',
})
export class TaskTimeGridComponent implements AfterViewInit, OnDestroy {
  readonly days = input.required<Date[]>();
  readonly tasks = input<AgendaTask[]>([]);
  readonly selectedKey = input<string | null>(null);

  readonly taskSelected = output<AgendaTask>();
  readonly taskOpened = output<AgendaTask>();
  readonly slotClicked = output<SlotClick>();
  readonly dayOpened = output<Date>();
  readonly taskMoved = output<TaskMove>();
  readonly taskHovered = output<TaskHover>();
  readonly hoverEnded = output<void>();

  readonly hourPx = HOUR_PX;
  readonly hours = HOURS;
  readonly types = TASK_TYPES;
  readonly weekdayShort = WEEKDAY_SHORT;
  readonly now = signal(new Date());

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly injector = inject(Injector);
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Rango para el que ya se colocó el scroll y si se hizo con tareas a la vista. */
  private scrolledRange = '';
  private scrolledToTasks = false;
  private dragging: { task: AgendaTask; grabMinutes: number } | null = null;

  readonly columns = computed(() => {
    const buckets = bucketByDay(this.tasks(), this.days());
    return this.days().map((date) => {
      const bucket = buckets.get(dateKey(date)) ?? { allDay: [], notes: [], timed: [] };
      return { date, key: dateKey(date), isToday: sameDay(date, this.now()), allDay: bucket.allDay, notes: bucket.notes, timed: bucket.timed };
    });
  });

  readonly hasAllDay = computed(() => this.columns().some((c) => c.allDay.length > 0));
  readonly hasNotes = computed(() => this.columns().some((c) => c.notes.length > 0));

  /** Notas del día que se muestran sin desplegar; el resto está tras «Ver acciones». */
  readonly notesVisible = 2;
  /** Días con las notas desplegadas. */
  readonly expandedNotes = signal<ReadonlySet<string>>(new Set());

  notesShown(col: { key: string; notes: AgendaTask[] }): AgendaTask[] {
    return this.expandedNotes().has(col.key) ? col.notes : col.notes.slice(0, this.notesVisible);
  }

  toggleNotes(key: string): void {
    this.expandedNotes.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  readonly nowTop = computed(() => {
    const now = this.now();
    return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
  });

  constructor() {
    // Al cambiar de rango, y de nuevo cuando llegan las primeras tareas, se
    // coloca el scroll en la primera tarea; no se vuelve a mover en cada
    // refresco para no robar el scroll a quien está trabajando.
    effect(() => {
      const range = `${dateKey(this.days()[0])}/${this.days().length}`;
      const hasTasks = this.columns().some((c) => c.timed.length > 0);
      untracked(() => {
        if (this.scrolledRange === range && (this.scrolledToTasks || !hasTasks)) return;
        this.scrolledRange = range;
        this.scrolledToTasks = hasTasks;
        afterNextRender({ write: () => this.scrollToFirstTask() }, { injector: this.injector });
      });
    });
  }

  ngAfterViewInit(): void {
    this.ticker = setInterval(() => this.now.set(new Date()), 60_000);
  }

  /** Sin tareas se abre a primera hora laboral; con tareas, una hora antes de la primera. */
  private scrollToFirstTask(): void {
    const starts = this.columns().flatMap((c) => c.timed.map((s) => s.startMin));
    const focusMinutes = starts.length > 0 ? Math.max(0, Math.min(...starts) - 60) : 8 * 60;
    const body = this.body()?.nativeElement;
    if (body) body.scrollTop = Math.max(0, (focusMinutes / 60) * HOUR_PX - 10);
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  blockStyle(segment: DaySegment): Record<string, string> {
    const top = (segment.startMin / 60) * HOUR_PX;
    const height = ((segment.visualEndMin - segment.startMin) / 60) * HOUR_PX - 2;
    return {
      top: `${top}px`,
      height: `${Math.max(height, 18)}px`,
      left: `calc(${(segment.column / segment.columns) * 100}% + 2px)`,
      width: `calc(${100 / segment.columns}% - 4px)`,
    };
  }

  /** Bloque alto: cabe una segunda línea con hora y comunidad. */
  isTall(segment: DaySegment): boolean {
    return segment.visualEndMin - segment.startMin >= 45;
  }

  timeLabel(task: AgendaTask): string {
    return timeRangeLabel(task);
  }

  label(task: AgendaTask): string {
    const parts = [
      task.title,
      timeRangeLabel(task),
      task.estate?.name,
      `prioridad ${TASK_PRIORITIES[task.priority].label.toLowerCase()}`,
      TASK_STATUSES[task.status].label.toLowerCase(),
      task.overdue ? 'vencida' : null,
    ];
    return parts.filter(Boolean).join(', ');
  }

  // ── Interacción ──────────────────────────────────────────────────────

  onColumnClick(event: MouseEvent, date: Date): void {
    const column = event.currentTarget as HTMLElement;
    if (event.target !== column && !(event.target as HTMLElement).classList.contains('col__line')) return;
    const y = event.clientY - column.getBoundingClientRect().top;
    this.slotClicked.emit({ date, minutes: this.snap((y / HOUR_PX) * 60) });
  }

  private snap(minutes: number): number {
    return Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));
  }

  // Arrastrar y soltar (API nativa de HTML5: no añade ninguna dependencia).
  onDragStart(event: DragEvent, task: AgendaTask, blockEl: HTMLElement): void {
    if (task.recurring) {
      event.preventDefault();
      return;
    }
    const grabY = event.clientY - blockEl.getBoundingClientRect().top;
    this.dragging = { task, grabMinutes: Math.max(0, (grabY / HOUR_PX) * 60) };
    event.dataTransfer?.setData('text/plain', task.occurrenceKey);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.hoverEnded.emit();
  }

  onDragEnd(): void {
    this.dragging = null;
  }

  onDragOver(event: DragEvent): void {
    if (this.dragging) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  }

  onDropTimed(event: DragEvent, date: Date): void {
    const drag = this.dragging;
    this.dragging = null;
    if (!drag || drag.task.allDay) return;
    event.preventDefault();
    const column = event.currentTarget as HTMLElement;
    const y = event.clientY - column.getBoundingClientRect().top;
    const minutes = this.snap((y / HOUR_PX) * 60 - drag.grabMinutes);
    const start = startOfDay(date);
    start.setMinutes(minutes);
    this.taskMoved.emit({ task: drag.task, start });
  }

  onDropAllDay(event: DragEvent, date: Date): void {
    const drag = this.dragging;
    this.dragging = null;
    if (!drag || !drag.task.allDay) return;
    event.preventDefault();
    this.taskMoved.emit({ task: drag.task, start: startOfDay(date) });
  }

  hover(task: AgendaTask, event: Event): void {
    this.taskHovered.emit({ task, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() });
  }
}
