import { Component, ElementRef, OnInit, afterNextRender, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { VISIBILITY_HINT, VISIBILITY_LABEL, type DocumentVisibility } from '../../../core/document-library.service';

export interface VisibilityTarget {
  kind: 'folder' | 'document';
  name: string;
  /** Own value; null = inherits. */
  visibility: DocumentVisibility | null;
  targetPropertyId?: string | null;
  /** What it would inherit (the parent folder's effective visibility); null = cannot inherit (root folder). */
  inherited: DocumentVisibility | null;
  /** A root document has no folder: it falls back to the default level instead. */
  inheritsDefault?: boolean;
}

export interface VisibilityChoice { visibility: DocumentVisibility | null; targetPropertyId: string | null }

const owners = (v: DocumentVisibility | null) => v === 'OWNERS' || v === 'PROPERTY';

/** Who sees a folder or a document. Opening to owners shows a personal-data warning (AEPD). */
@Component({
  selector: 'app-library-visibility-dialog',
  standalone: true,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  imports: [FormsModule, BtnComponent, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div #dialog class="modal" role="dialog" aria-modal="true" aria-labelledby="lv-title" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <div>
            <h4 id="lv-title">Quién ve {{ target().kind === 'folder' ? 'esta carpeta' : 'este documento' }}</h4>
            <p class="subtitle">{{ target().name }}</p>
          </div>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <div class="modal__body">
          <fieldset class="options">
            <legend class="sr-only">Visibilidad</legend>
            @if (target().inherited) {
              <label class="option" [class.option--on]="choice() === null">
                <input type="radio" name="lv" [checked]="choice() === null" (change)="choice.set(null)" />
                <span>
                  @if (target().inheritsDefault) {
                    <strong>Predeterminada ({{ label(target().inherited!) }})</strong>
                    <small>Si lo mueves a una carpeta, tomará la visibilidad de la carpeta.</small>
                  } @else {
                    <strong>Igual que la carpeta ({{ label(target().inherited!) }})</strong>
                    <small>Si cambia la carpeta, cambia también.</small>
                  }
                </span>
              </label>
            }
            @for (option of options(); track option) {
              <label class="option" [class.option--on]="choice() === option">
                <input type="radio" name="lv" [checked]="choice() === option" (change)="choice.set(option)" />
                <span><strong>{{ label(option) }}</strong><small>{{ hint(option) }}</small></span>
              </label>
            }
          </fieldset>
          @if (choice() === 'PROPERTY') {
            <label class="form-field">
              Propiedad
              <select id="lv-property" [ngModel]="propertyId()" (ngModelChange)="propertyId.set($event)">
                <option value="">Elige la propiedad…</option>
                @for (p of properties(); track p.id) { <option [value]="p.id">{{ p.label }}</option> }
              </select>
            </label>
          }
          @if (opensToOwners()) {
            <div class="warning" role="status">
              <app-icon name="exclamation" [size]="16"></app-icon>
              <p>Los propietarios podrán verlo. Comprueba que no contiene datos personales de otros vecinos (deudas, DNI, teléfonos…) que no deban conocer; el acta de la junta sí se comparte con todos.</p>
            </div>
          }
        </div>
        <div class="modal__footer">
          <app-btn variant="outline" (clicked)="closed.emit()">Cancelar</app-btn>
          <app-btn variant="accent" [disabled]="!valid()" (clicked)="save()">{{ opensToOwners() ? 'Abrir a propietarios' : 'Guardar' }}</app-btn>
        </div>
      </div>
    </div>
  `,
  styleUrl: './library-dialog.scss',
})
export class LibraryVisibilityDialogComponent implements OnInit {
  readonly target = input.required<VisibilityTarget>();
  readonly properties = input<{ id: string; label: string }[]>([]);
  readonly saved = output<VisibilityChoice>();
  readonly closed = output<void>();
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly choice = signal<DocumentVisibility | null>(null);
  readonly propertyId = signal('');
  readonly label = (v: DocumentVisibility) => VISIBILITY_LABEL[v];
  readonly hint = (v: DocumentVisibility) => VISIBILITY_HINT[v];

  readonly options = computed<DocumentVisibility[]>(() =>
    this.target().kind === 'folder' ? ['MANAGER', 'BOARD', 'OWNERS'] : ['MANAGER', 'BOARD', 'OWNERS', 'PROPERTY']);
  readonly effective = computed(() => this.choice() ?? this.target().inherited ?? 'MANAGER');
  /** Only warn when this change newly opens it to owners. */
  readonly opensToOwners = computed(() => owners(this.effective()) && !owners(this.target().visibility ?? this.target().inherited));
  readonly valid = computed(() => this.choice() !== 'PROPERTY' || !!this.propertyId());

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLInputElement>('input[type="radio"]:checked, input[type="radio"]')?.focus());
  }

  ngOnInit(): void {
    const t = this.target();
    // A root folder cannot inherit: show its effective value as the current choice.
    this.choice.set(t.visibility ?? (t.inherited ? null : 'MANAGER'));
    this.propertyId.set(t.targetPropertyId ?? '');
  }

  save(): void {
    if (!this.valid()) return;
    const visibility = this.choice();
    this.saved.emit({ visibility, targetPropertyId: visibility === 'PROPERTY' ? this.propertyId() : null });
  }
}
