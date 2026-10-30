import { Component, computed, input, output, signal } from '@angular/core';
import { AgendaTask, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskHover, TaskMove } from '../task-time-grid/task-time-grid.component';
import { WEEKDAY_SHORT, bucketByDay, dateKey, formatTime, sameDay, tasksOfDay, timeRangeLabel } from '../tasks.util';

/**
 * Vista mensual: cada día muestra unas pocas tareas y "+X más". Pulsar el día
 * abre su agenda (vista Día); el "+" de cada celda crea una tarea ese día. En
 * pantallas estrechas las celdas solo muestran el recuento.
 */
@Component({
  selector: 'app-task-month-grid',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './task-month-grid.component.html',
  styleUrl: './task-month-grid.component.scss',
})
export class TaskMonthGridComponent {
  readonly days = input.required<Date[]>();
  /** Cualquier fecha del mes mostrado: sirve para atenuar los días de otros meses. */
  readonly anchor = input.required<Date>();
  readonly tasks = input<AgendaTask[]>([]);
  readonly selectedKey = input<string | null>(null);
  readonly maxVisible = input(3);

  readonly taskSelected = output<AgendaTask>();
  readonly taskOpened = output<AgendaTask>();
  readonly daySelected = output<Date>();
  readonly createOnDay = output<Date>();
  readonly taskMoved = output<TaskMove>();
  readonly taskHovered = output<TaskHover>();
  readonly hoverEnded = output<void>();

  readonly types = TASK_TYPES;
  readonly weekdayShort = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAY_SHORT[d]);
  private readonly today = new Date();
  private dragging: AgendaTask | null = null;
  readonly dropTarget = signal<string | null>(null);

  readonly cells = computed(() => {
    const buckets = bucketByDay(this.tasks(), this.days());
    const month = this.anchor().getMonth();
    return this.days().map((date) => {
      const all = tasksOfDay(buckets.get(dateKey(date)));
      return {
        date,
        key: dateKey(date),
        inMonth: date.getMonth() === month,
        isToday: sameDay(date, this.today),
        visible: all.slice(0, this.maxVisible()),
        hidden: Math.max(0, all.length - this.maxVisible()),
        total: all.length,
      };
    });
  });

  time(task: AgendaTask): string {
    return task.allDay || task.noDuration ? '' : formatTime(new Date(task.occurrenceStart));
  }

  label(task: AgendaTask): string {
    return [
      task.title,
      timeRangeLabel(task),
      task.estate?.name,
      `prioridad ${TASK_PRIORITIES[task.priority].label.toLowerCase()}`,
      TASK_STATUSES[task.status].label.toLowerCase(),
      task.overdue ? 'vencida' : null,
    ].filter(Boolean).join(', ');
  }

  cellLabel(cell: { date: Date; total: number }): string {
    return `${cell.date.getDate()}: ${cell.total === 0 ? 'sin tareas' : cell.total === 1 ? '1 tarea' : cell.total + ' tareas'}`;
  }

  hover(task: AgendaTask, event: Event): void {
    this.taskHovered.emit({ task, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() });
  }

  onDragStart(event: DragEvent, task: AgendaTask): void {
    if (task.recurring) {
      event.preventDefault();
      return;
    }
    this.dragging = task;
    event.dataTransfer?.setData('text/plain', task.occurrenceKey);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.hoverEnded.emit();
  }

  onDragEnd(): void {
    this.dragging = null;
    this.dropTarget.set(null);
  }

  onDragOver(event: DragEvent, key: string): void {
    if (!this.dragging) return;
    event.preventDefault();
    this.dropTarget.set(key);
  }

  /** Mueve la tarea a otro día conservando su hora. */
  onDrop(event: DragEvent, date: Date): void {
    const task = this.dragging;
    this.dragging = null;
    this.dropTarget.set(null);
    if (!task) return;
    event.preventDefault();
    const original = new Date(task.occurrenceStart);
    const start = task.allDay
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), original.getHours(), original.getMinutes());
    this.taskMoved.emit({ task, start });
  }
}
