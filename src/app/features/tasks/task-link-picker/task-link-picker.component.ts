import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgendaLinkType, LINK_TYPES, LINK_TYPE_KEYS, LinkedEntity } from '../../../core/agenda-tasks.model';
import { ComunicadosService } from '../../../core/comunicados.service';
import { IssuesService } from '../../../core/issues.service';
import { MeetingsService } from '../../../core/meetings.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const LINK_TAB: Record<AgendaLinkType, string> = {
  issue: 'issues',
  meeting: 'juntas',
  supplier: 'providers',
  document: 'documents',
};

const PAGE_SIZE = 100;

/**
 * Añade una entidad de Domora (incidencia, junta, proveedor, documento) a una
 * tarea. Las opciones se cargan de la comunidad elegida con los servicios que
 * ya usa el resto de la aplicación; el backend vuelve a validar que la entidad
 * existe y que es accesible, así que esto es solo comodidad.
 */
@Component({
  selector: 'app-task-link-picker',
  standalone: true,
  imports: [FormsModule, IconComponent, SelectDropdownDirective],
  template: `
    @if (!estateId()) {
      <p class="hint">Elige primero una comunidad para vincular incidencias, juntas, proveedores o documentos.</p>
    } @else {
      <div class="picker">
        <select aria-label="Tipo de entidad" [ngModel]="type()" (ngModelChange)="onType($event)">
          @for (key of typeKeys; track key) {
            <option [value]="key">{{ types[key].label }}</option>
          }
        </select>
        <select aria-label="Entidad a vincular" [ngModel]="choice()" (ngModelChange)="choice.set($event)" [disabled]="loading() || options().length === 0">
          <option value="">{{ loading() ? 'Cargando…' : options().length === 0 ? 'No hay ' + types[type()].label.toLowerCase() + 's' : 'Selecciona…' }}</option>
          @for (option of options(); track option.id) {
            <option [value]="option.id">{{ option.label }}</option>
          }
        </select>
        <button type="button" class="picker__add" [disabled]="!choice()" (click)="add()">
          <app-icon name="link" [size]="13"></app-icon> Vincular
        </button>
      </div>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    }
  `,
  styles: [`
    .hint { font-size: 13px; color: var(--color-muted); }
    .picker { display: flex; gap: 6px; flex-wrap: wrap; }
    .picker select { max-width: 100%; }
    .picker select:nth-child(2) { flex: 1; min-width: 160px; }
    .picker__add { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; min-height: 36px; border-radius: var(--radius-md); border: 1px solid var(--color-border); color: var(--color-text); font-size: 14px; }
    .picker__add:disabled { opacity: 0.4; cursor: not-allowed; }
    .picker__add:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .error { color: var(--color-error); font-size: 13px; margin-top: 4px; }
  `],
})
export class TaskLinkPickerComponent {
  private readonly issues = inject(IssuesService);
  private readonly meetings = inject(MeetingsService);
  private readonly suppliers = inject(SuppliersStaffService);
  private readonly documents = inject(ComunicadosService);

  readonly estateId = input<string | null>(null);
  /** Entidades ya vinculadas: no se vuelven a ofrecer. */
  readonly linked = input<LinkedEntity[]>([]);
  readonly linkAdded = output<LinkedEntity>();

  readonly types = LINK_TYPES;
  readonly typeKeys = LINK_TYPE_KEYS;
  readonly type = signal<AgendaLinkType>('issue');
  readonly options = signal<{ id: string; label: string }[]>([]);
  readonly choice = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  private requestId = 0;

  constructor() {
    // Recarga las opciones al cambiar la comunidad o el tipo.
    effect(() => {
      const estateId = this.estateId();
      const type = this.type();
      untracked(() => void this.load(estateId, type));
    });
  }

  onType(type: AgendaLinkType): void {
    this.type.set(type);
    this.choice.set('');
  }

  private async load(estateId: string | null, type: AgendaLinkType): Promise<void> {
    const request = ++this.requestId;
    this.options.set([]);
    this.error.set('');
    if (!estateId) return;
    this.loading.set(true);
    try {
      const all = await this.fetchOptions(estateId, type);
      if (request !== this.requestId) return;
      const taken = new Set(this.linked().filter((l) => l.type === type).map((l) => l.id));
      this.options.set(all.filter((o) => !taken.has(o.id)));
    } catch {
      if (request === this.requestId) this.error.set('No se pudieron cargar las opciones.');
    } finally {
      if (request === this.requestId) this.loading.set(false);
    }
  }

  private async fetchOptions(estateId: string, type: AgendaLinkType): Promise<{ id: string; label: string }[]> {
    switch (type) {
      case 'issue': {
        const page = await this.issues.listIssuesForEstate(estateId, { pageSize: PAGE_SIZE });
        return page.items.map((i) => ({ id: i.id, label: `${i.ref} · ${i.title}` }));
      }
      case 'meeting':
        return (await this.meetings.listMeetingsByEstate(estateId)).map((m) => ({ id: m.id, label: m.title }));
      case 'supplier':
        return (await this.suppliers.listSuppliers(estateId)).map((s) => ({ id: s.id, label: s.name }));
      case 'document': {
        const page = await this.documents.listDocumentsByEstate(estateId, { pageSize: PAGE_SIZE });
        return page.items.map((d) => ({ id: d.id, label: d.title }));
      }
    }
  }

  add(): void {
    const estateId = this.estateId();
    const option = this.options().find((o) => o.id === this.choice());
    if (!estateId || !option) return;
    const type = this.type();
    this.linkAdded.emit({
      type,
      id: option.id,
      label: option.label,
      estateId,
      route: `/b/estates/${estateId}?tab=${LINK_TAB[type]}&entity=${option.id}`,
    });
    this.options.update((options) => options.filter((o) => o.id !== option.id));
    this.choice.set('');
  }
}
