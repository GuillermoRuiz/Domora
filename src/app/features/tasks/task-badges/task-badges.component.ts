import { Component, computed, input } from '@angular/core';
import { AgendaTaskPriority, AgendaTaskStatus, TASK_PRIORITIES, TASK_STATUSES } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Prioridad = ÚNICO canal de color de la agenda (rojo/naranja/azul/gris). Se
 * acompaña siempre de icono y texto: el color nunca es lo único que informa.
 */
@Component({
  selector: 'app-task-priority',
  standalone: true,
  imports: [IconComponent],
  template: `<span class="pill" [class]="'pill pill--' + priority().toLowerCase()">
    <app-icon [name]="meta().icon" [size]="11" aria-hidden="true"></app-icon>{{ meta().label }}
  </span>`,
  styles: [`
    .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .pill--urgente { background: var(--color-error-bg); color: var(--color-error); }
    .pill--alta { background: var(--color-warning-bg); color: var(--color-warning); }
    .pill--media { background: var(--color-blue-bg); color: var(--color-blue); }
    .pill--baja { background: var(--color-border-light); color: var(--color-muted); }
  `],
})
export class TaskPriorityBadgeComponent {
  readonly priority = input.required<AgendaTaskPriority>();
  readonly meta = computed(() => TASK_PRIORITIES[this.priority()]);
}

/** Estado de la tarea; "Vencida" se muestra aparte porque se calcula, no se guarda. */
@Component({
  selector: 'app-task-status',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (overdue()) {
      <span class="pill pill--overdue"><app-icon name="exclamation" [size]="11" aria-hidden="true"></app-icon>Vencida</span>
    }
    <span class="pill" [class]="'pill pill--' + status().toLowerCase()">
      <app-icon [name]="meta().icon" [size]="11" aria-hidden="true"></app-icon>{{ meta().label }}
    </span>`,
  styles: [`
    :host { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap; background: var(--color-border-light); color: var(--color-muted); }
    .pill--completada { background: var(--color-secondary-bg); color: var(--color-secondary); }
    .pill--cancelada { text-decoration: line-through; }
    .pill--overdue { background: transparent; color: var(--color-error); border: 1px solid var(--color-error-border); }
  `],
})
export class TaskStatusBadgeComponent {
  readonly status = input.required<AgendaTaskStatus>();
  readonly overdue = input(false);
  readonly meta = computed(() => TASK_STATUSES[this.status()]);
}
