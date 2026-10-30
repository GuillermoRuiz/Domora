import { Component, ElementRef, OnInit, afterNextRender, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { LibraryFolder } from '../../../core/document-library.service';
import { folderOptions } from './library-tree';

export type NameDialogMode =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename'; target: 'folder' | 'document'; current: string }
  | { kind: 'move'; target: 'folder' | 'document'; name: string; currentFolderId: string | null; folderId?: string };

/** `name` for create/rename, `folderId` for move. */
export interface NameDialogResult { name?: string; folderId?: string | null }

/** New folder, rename (folder or document) and move (folder or document). */
@Component({
  selector: 'app-library-name-dialog',
  standalone: true,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  imports: [FormsModule, BtnComponent, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="ln-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <div class="modal__header">
          <div>
            <h4 id="ln-title">{{ title() }}</h4>
            @if (subtitle()) { <p class="subtitle">{{ subtitle() }}</p> }
          </div>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <div class="modal__body">
          @if (mode().kind === 'move') {
            <label class="form-field">
              Mover a
              <select #field id="ln-folder" name="folder" [ngModel]="folderId()" (ngModelChange)="folderId.set($event)">
                @for (o of destinations(); track o.id) { <option [ngValue]="o.id">{{ o.label }}</option> }
              </select>
            </label>
          } @else {
            <label class="form-field">
              Nombre
              <input #field id="ln-name" name="name" type="text" maxlength="255" autocomplete="off" [ngModel]="name()" (ngModelChange)="name.set($event)" />
            </label>
          }
          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
        </div>
        <div class="modal__footer">
          <app-btn variant="outline" (clicked)="closed.emit()">Cancelar</app-btn>
          <app-btn variant="accent" [disabled]="!valid() || busy()" (clicked)="save()">{{ action() }}</app-btn>
        </div>
      </form>
    </div>
  `,
  styleUrl: './library-dialog.scss',
})
export class LibraryNameDialogComponent implements OnInit {
  readonly mode = input.required<NameDialogMode>();
  readonly folders = input<LibraryFolder[]>([]);
  readonly busy = input(false);
  /** Server error shown inside the dialog (e.g. a duplicate name). */
  readonly error = input<string | null>(null);
  readonly saved = output<NameDialogResult>();
  readonly closed = output<void>();
  private readonly field = viewChild<ElementRef<HTMLInputElement | HTMLSelectElement>>('field');

  readonly name = signal('');
  readonly folderId = signal<string | null>(null);

  readonly title = computed(() => {
    const m = this.mode();
    if (m.kind === 'create') return 'Nueva carpeta';
    if (m.kind === 'rename') return m.target === 'folder' ? 'Renombrar carpeta' : 'Renombrar documento';
    return m.target === 'folder' ? 'Mover carpeta' : 'Mover documento';
  });
  readonly subtitle = computed(() => {
    const m = this.mode();
    if (m.kind === 'create') return m.parentId ? `Dentro de «${this.folders().find(f => f.id === m.parentId)?.name ?? ''}»` : null;
    return m.kind === 'move' ? m.name : null;
  });
  readonly action = computed(() => ({ create: 'Crear carpeta', rename: 'Guardar', move: 'Mover' })[this.mode().kind]);
  readonly destinations = computed(() => {
    const m = this.mode();
    return folderOptions(this.folders(), { root: 'Sin carpeta (raíz)', exclude: m.kind === 'move' && m.target === 'folder' ? m.folderId : undefined });
  });
  readonly valid = computed(() => {
    const m = this.mode();
    if (m.kind === 'move') return this.folderId() !== m.currentFolderId;
    const value = this.name().trim();
    return value.length > 0 && (m.kind !== 'rename' || value !== m.current);
  });

  constructor() {
    afterNextRender(() => {
      const el = this.field()?.nativeElement;
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
  }

  ngOnInit(): void {
    const m = this.mode();
    if (m.kind === 'rename') this.name.set(m.current);
    if (m.kind === 'move') this.folderId.set(m.currentFolderId);
  }

  save(): void {
    if (!this.valid() || this.busy()) return;
    this.saved.emit(this.mode().kind === 'move' ? { folderId: this.folderId() } : { name: this.name().trim() });
  }
}
