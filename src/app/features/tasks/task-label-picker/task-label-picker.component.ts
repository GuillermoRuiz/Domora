import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DropdownComponent, DropdownItem } from '../../../shared/components/dropdown/dropdown.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TaskCatalogService } from '../task-catalog.service';

/**
 * Etiquetas de una tarea: las del catálogo de la gestora en un desplegable de selección múltiple, más un campo para crear
 * una nueva sobre la marcha. Las etiquetas son libres y no tienen color: no deben competir con la prioridad.
 */
@Component({
  selector: 'app-task-label-picker',
  standalone: true,
  imports: [FormsModule, IconComponent, DropdownComponent],
  template: `
    <div class="labels" role="group" aria-label="Etiquetas">
      <app-dropdown
        class="labels__select"
        ariaLabel="Etiquetas"
        label="Etiquetas"
        icon="tag"
        [multiple]="true"
        [items]="items()"
        [selectedIds]="selected()"
        [summary]="summary()"
        [active]="selected().length > 0"
        emptyText="Aún no hay etiquetas."
        (selectionChange)="toggle($any($event.id))"
      >
        @if (allowCreate()) {
          <form ddExtra class="new" (ngSubmit)="create()">
            <input class="field--bare" type="text" name="newLabel" maxlength="60" placeholder="Nueva etiqueta" aria-label="Nueva etiqueta" [ngModel]="draft()" (ngModelChange)="draft.set($event)" />
            <button type="submit" class="new__btn" [disabled]="!draft().trim() || creating()" aria-label="Crear etiqueta">
              <app-icon name="plus" [size]="12"></app-icon>
            </button>
          </form>
        }
      </app-dropdown>
    </div>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .labels__select { min-width: 0; }
    .new__btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .new { display: flex; gap: 6px; align-items: center; }
    .new input { flex: 1; min-width: 0; padding: 6px 12px; border-radius: var(--radius-md); border: 1px dashed var(--color-border); background: transparent; color: var(--color-text); font-size: 13px; min-height: 36px; }
    .new__btn { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--color-border); color: var(--color-muted); display: inline-flex; align-items: center; justify-content: center; }
    .new__btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .error { color: var(--color-error); font-size: 13px; margin-top: 4px; }
  `],
})
export class TaskLabelPickerComponent {
  readonly catalog = inject(TaskCatalogService);

  readonly selected = input<string[]>([]);
  readonly allowCreate = input(true);
  readonly selectedChange = output<string[]>();

  readonly draft = signal('');
  readonly creating = signal(false);
  readonly error = signal('');
  private readonly selectedSet = computed(() => new Set(this.selected()));

  readonly items = computed<DropdownItem[]>(() => this.catalog.labels().map((label) => ({ id: label.id, label: label.name })));
  readonly summary = computed(() => {
    const ids = this.selected();
    if (ids.length === 0) return 'Etiquetas';
    const names = ids.map((id) => this.catalog.labelsById().get(id)?.name).filter(Boolean);
    return names.length === 1 ? (names[0] as string) : `${ids.length} etiquetas`;
  });

  isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  toggle(id: string): void {
    const next = new Set(this.selectedSet());
    if (!next.delete(id)) next.add(id);
    this.selectedChange.emit([...next]);
  }

  async create(): Promise<void> {
    const name = this.draft().trim();
    if (!name || this.creating()) return;
    this.creating.set(true);
    this.error.set('');
    try {
      const label = await this.catalog.createLabel(name);
      this.draft.set('');
      if (!this.selectedSet().has(label.id)) this.selectedChange.emit([...this.selected(), label.id]);
    } catch {
      this.error.set('No se pudo crear la etiqueta.');
    } finally {
      this.creating.set(false);
    }
  }
}
