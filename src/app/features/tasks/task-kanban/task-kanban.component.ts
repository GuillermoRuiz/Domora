import { Component, computed, input, output, signal } from '@angular/core';
import {
  AgendaTask,
  AgendaTaskStatus,
  TASK_STATUSES,
  TASK_STATUS_KEYS,
  TASK_TYPES,
} from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskPriorityBadgeComponent } from '../task-badges/task-badges.component';
import { longDateLabel, taskDay, timeRangeLabel } from '../tasks.util';

export interface TaskStatusChange {
  task: AgendaTask;
  status: AgendaTaskStatus;
}

interface Column {
  status: AgendaTaskStatus;
  label: string;
  icon: string;
  tasks: AgendaTask[];
}

/**
 * Tablero por estado. Arrastrar una tarjeta a otra columna cambia su estado
 * (en una serie, solo el de esa ocurrencia). El arrastre es una comodidad para
 * el ratón: el estado también se cambia desde el detalle, que es accesible
 * con teclado.
 */
@Component({
  selector: 'app-task-kanban',
  standalone: true,
  imports: [IconComponent, TaskPriorityBadgeComponent],
  templateUrl: './task-kanban.component.html',
  styleUrl: './task-kanban.component.scss',
})
export class TaskKanbanComponent {
  readonly tasks = input<AgendaTask[]>([]);
  readonly selectedKey = input<string | null>(null);

  readonly taskSelected = output<AgendaTask>();
  readonly taskOpened = output<AgendaTask>();
  readonly statusChanged = output<TaskStatusChange>();

  readonly types = TASK_TYPES;
  /** Columna sobre la que se está arrastrando, para resaltarla. */
  readonly dropTarget = signal<AgendaTaskStatus | null>(null);
  private dragging: AgendaTask | null = null;

  readonly columns = computed<Column[]>(() =>
    TASK_STATUS_KEYS.map((status) => ({
      status,
      label: TASK_STATUSES[status].label,
      icon: TASK_STATUSES[status].icon,
      tasks: this.tasks().filter((t) => t.status === status),
    })),
  );

  date(task: AgendaTask): string {
    return `${longDateLabel(taskDay(task))} · ${timeRangeLabel(task)}`;
  }

  onDragStart(event: DragEvent, task: AgendaTask): void {
    this.dragging = task;
    event.dataTransfer?.setData('text/plain', task.occurrenceKey);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd(): void {
    this.dragging = null;
    this.dropTarget.set(null);
  }

  onDragOver(event: DragEvent, status: AgendaTaskStatus): void {
    if (!this.dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(status);
  }

  onDrop(event: DragEvent, status: AgendaTaskStatus): void {
    event.preventDefault();
    const task = this.dragging;
    this.onDragEnd();
    if (task && task.status !== status) this.statusChanged.emit({ task, status });
  }
}
