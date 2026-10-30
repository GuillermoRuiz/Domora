import { Component, computed, inject, input, output, signal } from '@angular/core';
import {
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
  TASK_PRIORITIES,
  TASK_PRIORITY_KEYS,
  TASK_STATUSES,
  TASK_STATUS_KEYS,
  TASK_TYPES,
  TASK_TYPE_KEYS,
} from '../../../core/agenda-tasks.model';
import { DropdownComponent, DropdownItem } from '../../../shared/components/dropdown/dropdown.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskCatalogService } from '../task-catalog.service';

/** Filtros combinables de la agenda; cadena vacía / lista vacía = sin filtrar. */
export interface TaskFilterState {
  estateId: string;
  /** '' = todos · 'me' · 'none' (sin asignar) · id de usuario. */
  assignee: string;
  status: AgendaTaskStatus | '';
  priority: AgendaTaskPriority | '';
  type: AgendaTaskType | '';
  labelIds: string[];
}

export const EMPTY_FILTERS: TaskFilterState = {
  estateId: '',
  assignee: '',
  status: '',
  priority: '',
  type: '',
  labelIds: [],
};

export function activeFilterCount(f: TaskFilterState): number {
  return [f.assignee, f.status, f.priority, f.type].filter(Boolean).length + (f.labelIds.length > 0 ? 1 : 0);
}

/**
 * Barra de filtros compacta. En pantallas estrechas se pliega tras un botón
 * "Filtros (n)" para no ocupar media pantalla.
 */
@Component({
  selector: 'app-task-filters',
  standalone: true,
  imports: [DropdownComponent, IconComponent],
  templateUrl: './task-filters.component.html',
  styleUrl: './task-filters.component.scss',
})
export class TaskFiltersComponent {
  readonly catalog = inject(TaskCatalogService);

  readonly filters = input.required<TaskFilterState>();
  readonly filtersChange = output<TaskFilterState>();

  // La opción con id '' es "sin filtrar" (el estado vacío de TaskFilterState).
  readonly statusItems: DropdownItem[] = [{ id: '', label: 'Todos los estados' }, ...TASK_STATUS_KEYS.map((key) => ({ id: key, label: TASK_STATUSES[key].label }))];
  readonly priorityItems: DropdownItem[] = [{ id: '', label: 'Todas las prioridades' }, ...TASK_PRIORITY_KEYS.map((key) => ({ id: key, label: TASK_PRIORITIES[key].label }))];
  readonly typeItems: DropdownItem[] = [{ id: '', label: 'Todos los tipos' }, ...TASK_TYPE_KEYS.map((key) => ({ id: key, label: TASK_TYPES[key].label, icon: TASK_TYPES[key].icon }))];

  readonly assigneeItems = computed<DropdownItem[]>(() => [
    { id: '', label: 'Todos los responsables' },
    { id: 'me', label: 'Yo' },
    { id: 'none', label: 'Sin asignar' },
    ...this.catalog.assignees().map((person) => ({ id: person.id, label: person.fullName })),
  ]);

  readonly labelItems = computed<DropdownItem[]>(() => this.catalog.labels().map((label) => ({ id: label.id, label: label.name })));

  readonly expanded = signal(false);
  readonly activeCount = computed(() => activeFilterCount(this.filters()));

  readonly labelsSummary = computed(() => {
    const ids = this.filters().labelIds;
    if (ids.length === 0) return 'Etiquetas';
    const names = ids.map((id) => this.catalog.labelsById().get(id)?.name).filter(Boolean);
    return names.length === 1 ? (names[0] as string) : `${ids.length} etiquetas`;
  });

  set<K extends keyof TaskFilterState>(key: K, value: TaskFilterState[K]): void {
    this.filtersChange.emit({ ...this.filters(), [key]: value });
  }

  /** Traduce la opción elegida en un desplegable al campo de filtro correspondiente. */
  pick<K extends keyof TaskFilterState>(key: K, item: DropdownItem): void {
    this.set(key, String(item.id) as TaskFilterState[K]);
  }

  toggleLabel(id: string): void {
    const current = this.filters().labelIds;
    this.set('labelIds', current.includes(id) ? current.filter((l) => l !== id) : [...current, id]);
  }

  clear(): void {
    this.filtersChange.emit({ ...EMPTY_FILTERS, estateId: this.filters().estateId, labelIds: [] });
  }
}
