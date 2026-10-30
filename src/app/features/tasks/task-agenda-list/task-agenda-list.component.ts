import { Component, computed, input, output } from '@angular/core';
import { AgendaTask, TASK_TYPES } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskPriorityBadgeComponent, TaskStatusBadgeComponent } from '../task-badges/task-badges.component';
import { longDateLabel, timeRangeLabel } from '../tasks.util';

interface DayGroup {
  key: string;
  label: string;
  tasks: AgendaTask[];
}

/**
 * Agenda en lista, agrupada por día. Sustituye a la cuadrícula en móvil (siete
 * columnas comprimidas no se pueden usar) y es la vista de las listas sin
 * rango —vencidas, urgentes—, donde el calendario no es el formato adecuado.
 */
@Component({
  selector: 'app-task-agenda-list',
  standalone: true,
  imports: [IconComponent, TaskPriorityBadgeComponent, TaskStatusBadgeComponent],
  templateUrl: './task-agenda-list.component.html',
  styleUrl: './task-agenda-list.component.scss',
})
export class TaskAgendaListComponent {
  readonly tasks = input<AgendaTask[]>([]);
  readonly selectedKey = input<string | null>(null);

  readonly taskSelected = output<AgendaTask>();
  readonly taskOpened = output<AgendaTask>();
  readonly taskCompleted = output<AgendaTask>();
  /** Desmarcar una tarea completada. */
  readonly taskReopened = output<AgendaTask>();

  readonly types = TASK_TYPES;

  readonly groups = computed<DayGroup[]>(() => {
    const groups = new Map<string, DayGroup>();
    for (const task of this.tasks()) {
      // Día de calendario: las de día completo se leen en UTC, el resto en local.
      const date = task.allDay ? this.utcDay(task.occurrenceStart) : new Date(task.occurrenceStart);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, label: longDateLabel(date), tasks: [] };
        groups.set(key, group);
      }
      group.tasks.push(task);
    }
    return [...groups.values()];
  });

  private utcDay(iso: string): Date {
    const d = new Date(iso);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  time(task: AgendaTask): string {
    return timeRangeLabel(task);
  }

  /** Las canceladas no tienen casilla: se reabren desde el detalle. */
  hasCheck(task: AgendaTask): boolean {
    return task.status !== 'CANCELADA';
  }

  /** Casilla: completa la tarea o, si ya lo está, la desmarca. */
  toggle(event: Event, task: AgendaTask): void {
    event.stopPropagation();
    if (task.status === 'COMPLETADA') this.taskReopened.emit(task);
    else this.taskCompleted.emit(task);
  }
}
