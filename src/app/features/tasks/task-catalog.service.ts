import { Injectable, computed, inject, signal } from '@angular/core';
import { AgendaTasksService } from '../../core/agenda-tasks.service';
import { EstatesService } from '../../core/estates.service';
import { PersonRef, TaskLabel } from '../../core/agenda-tasks.model';
import { Estate } from '../../core/models';

/**
 * Catálogos que comparten los filtros, el formulario y el panel de detalle:
 * comunidades, responsables posibles y etiquetas de la gestora. Se cargan una
 * vez por sesión de la pantalla (no por cada componente que los pinta).
 */
@Injectable({ providedIn: 'root' })
export class TaskCatalogService {
  private readonly agenda = inject(AgendaTasksService);
  private readonly estatesService = inject(EstatesService);

  readonly estates = signal<Estate[]>([]);
  readonly assignees = signal<PersonRef[]>([]);
  readonly labels = signal<TaskLabel[]>([]);
  readonly loaded = signal(false);
  readonly error = signal(false);
  private loading: Promise<void> | null = null;

  readonly labelsById = computed(() => new Map(this.labels().map((l) => [l.id, l])));

  /** Idempotente: varias llamadas simultáneas comparten la misma carga. */
  load(force = false): Promise<void> {
    if (this.loaded() && !force) return Promise.resolve();
    this.loading ??= this.fetch().finally(() => (this.loading = null));
    return this.loading;
  }

  private async fetch(): Promise<void> {
    try {
      const [estates, assignees, labels] = await Promise.all([
        this.estatesService.listEstates(),
        this.agenda.listAssignees(),
        this.agenda.listLabels(),
      ]);
      this.estates.set(estates);
      this.assignees.set(assignees);
      this.labels.set(labels);
      this.loaded.set(true);
      this.error.set(false);
    } catch (error) {
      console.error('No se pudieron cargar los catálogos de Tareas', error);
      this.error.set(true);
    }
  }

  async createLabel(name: string): Promise<TaskLabel> {
    const label = await this.agenda.createLabel(name);
    this.labels.update((labels) =>
      labels.some((l) => l.id === label.id) ? labels : [...labels, label].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    );
    return label;
  }
}
