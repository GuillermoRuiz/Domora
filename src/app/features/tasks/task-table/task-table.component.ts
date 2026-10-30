import { Component, computed, input, output } from '@angular/core';
import { AgendaTask, TASK_TYPES } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskPriorityBadgeComponent, TaskStatusBadgeComponent } from '../task-badges/task-badges.component';
import { longDateLabel, taskDay, timeRangeLabel } from '../tasks.util';

/**
 * Vista de tabla: una fila por tarea (u ocurrencia de una serie) del periodo
 * que se está mirando, en el orden en que las devuelve el servidor.
 */
@Component({
  selector: 'app-task-table',
  standalone: true,
  imports: [IconComponent, TaskPriorityBadgeComponent, TaskStatusBadgeComponent],
  templateUrl: './task-table.component.html',
  styleUrl: './task-table.component.scss',
})
export class TaskTableComponent {
  readonly tasks = input<AgendaTask[]>([]);
  readonly selectedKey = input<string | null>(null);
  /** `occurrenceKey` de las filas marcadas para una acción en bloque. */
  readonly checkedKeys = input<string[]>([]);

  readonly taskSelected = output<AgendaTask>();
  readonly taskOpened = output<AgendaTask>();
  readonly checkedKeysChange = output<string[]>();

  readonly allChecked = computed(() => this.tasks().length > 0 && this.tasks().every((t) => this.isChecked(t)));
  readonly someChecked = computed(() => !this.allChecked() && this.tasks().some((t) => this.isChecked(t)));

  readonly types = TASK_TYPES;

  date(task: AgendaTask): string {
    return longDateLabel(taskDay(task));
  }

  time(task: AgendaTask): string {
    return timeRangeLabel(task);
  }

  isChecked(task: AgendaTask): boolean {
    return this.checkedKeys().includes(task.occurrenceKey);
  }

  toggleOne(task: AgendaTask): void {
    const keys = this.checkedKeys();
    this.checkedKeysChange.emit(
      keys.includes(task.occurrenceKey) ? keys.filter((k) => k !== task.occurrenceKey) : [...keys, task.occurrenceKey],
    );
  }

  toggleAll(): void {
    this.checkedKeysChange.emit(this.allChecked() ? [] : this.tasks().map((t) => t.occurrenceKey));
  }

}
