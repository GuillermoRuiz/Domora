import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { DocumentLibraryService, VISIBILITY_HINT, VISIBILITY_LABEL, type DocumentVisibility, type LibraryFolder } from '../../../core/document-library.service';
import { ESSENTIAL_DOCUMENT_TYPES } from '../../../core/essential-documents';
import { folderOptions } from './library-tree';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.xml,.txt';
export const DOCUMENT_TYPES = ['Otro', ...ESSENTIAL_DOCUMENT_TYPES, 'Acta', 'Presupuesto', 'Contrato', 'Factura', 'Certificado'];

interface QueuedFile { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }

/** Uploads one or more files into a folder; by default they inherit the folder's visibility. */
@Component({
  selector: 'app-library-upload-dialog',
  standalone: true,
  host: { '(document:keydown.escape)': 'close()' },
  imports: [FormsModule, BtnComponent, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <div class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="lu-title" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <h4 id="lu-title">Subir documentos</h4>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="close()"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <div class="modal__body">
          <label class="drop" [class.drop--over]="dragOver()" (dragover)="$event.preventDefault(); dragOver.set(true)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
            <input id="lu-files" type="file" multiple [accept]="accept" (change)="onPick($event)" class="sr-only" />
            <app-icon name="upload" [size]="20"></app-icon>
            <span><strong>Elige ficheros</strong> o arrástralos aquí</span>
            <small>PDF, imágenes, Word, Excel o texto · máximo 10 MB por fichero</small>
          </label>
          @if (queue().length) {
            <ul class="queue">
              @for (q of queue(); track q.file) {
                <li class="queue__item" [class.queue__item--error]="q.status === 'error'">
                  <app-icon [name]="q.status === 'done' ? 'check' : q.status === 'error' ? 'exclamation' : 'file'" [size]="14"></app-icon>
                  <span class="queue__name">{{ q.file.name }}</span>
                  <span class="queue__state">{{ stateLabel(q) }}</span>
                  @if (q.status === 'pending' && !busy()) {
                    <button type="button" class="queue__remove" [attr.aria-label]="'Quitar ' + q.file.name" (click)="remove(q)"><app-icon name="x" [size]="12"></app-icon></button>
                  }
                </li>
              }
            </ul>
          }
          <div class="grid">
            <label class="form-field">
              Carpeta
              <select id="lu-folder" [ngModel]="folderId()" (ngModelChange)="folderId.set($event)">
                @for (o of destinations(); track o.id) { <option [ngValue]="o.id">{{ o.label }}</option> }
              </select>
            </label>
            <label class="form-field">
              Tipo
              <select id="lu-type" [ngModel]="type()" (ngModelChange)="type.set($event)">
                @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
              </select>
            </label>
          </div>
          <label class="form-field">
            Quién lo ve
            <select id="lu-visibility" [ngModel]="visibility()" (ngModelChange)="visibility.set($event)">
              <option [ngValue]="null">Igual que la carpeta ({{ inheritedLabel() }})</option>
              @for (v of levels; track v) { <option [ngValue]="v">{{ label(v) }}</option> }
            </select>
          </label>
          <p class="hint">{{ hint() }}</p>
          @if (visibility() === 'PROPERTY') {
            <label class="form-field">
              Propiedad
              <select id="lu-property" [ngModel]="propertyId()" (ngModelChange)="propertyId.set($event)">
                <option value="">Elige la propiedad…</option>
                @for (p of properties(); track p.id) { <option [value]="p.id">{{ p.label }}</option> }
              </select>
            </label>
          }
          @if (opensToOwners()) {
            <div class="warning" role="status">
              <app-icon name="exclamation" [size]="16"></app-icon>
              <p>Los propietarios podrán verlos y recibirán un aviso. Comprueba que no contienen datos personales de otros vecinos que no deban conocer.</p>
            </div>
          }
          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
        </div>
        <div class="modal__footer">
          <app-btn variant="outline" [disabled]="busy()" (clicked)="close()">{{ finished() ? 'Cerrar' : 'Cancelar' }}</app-btn>
          @if (!finished()) {
            <app-btn variant="accent" [disabled]="busy() || !canUpload()" (clicked)="upload()">
              {{ busy() ? 'Subiendo…' : pendingCount() > 1 ? 'Subir ' + pendingCount() + ' ficheros' : 'Subir' }}
            </app-btn>
          }
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./library-dialog.scss', './library-upload-dialog.scss'],
})
export class LibraryUploadDialogComponent implements OnInit {
  private readonly library = inject(DocumentLibraryService);

  readonly estateId = input.required<string>();
  readonly folders = input.required<LibraryFolder[]>();
  readonly initialFolderId = input<string | null>(null);
  readonly properties = input<{ id: string; label: string }[]>([]);
  /** Emitted after each batch with how many files went up (the tab reloads). */
  readonly uploaded = output<number>();
  readonly closed = output<void>();

  readonly accept = ACCEPT;
  readonly types = DOCUMENT_TYPES;
  readonly levels: DocumentVisibility[] = ['MANAGER', 'BOARD', 'OWNERS', 'PROPERTY'];
  readonly label = (v: DocumentVisibility) => VISIBILITY_LABEL[v];

  readonly queue = signal<QueuedFile[]>([]);
  readonly folderId = signal<string | null>(null);
  readonly type = signal('Otro');
  readonly visibility = signal<DocumentVisibility | null>(null);
  readonly propertyId = signal('');
  readonly busy = signal(false);
  readonly dragOver = signal(false);
  readonly error = signal<string | null>(null);

  readonly destinations = computed(() => folderOptions(this.folders(), { root: 'Sin carpeta (raíz)' }));
  readonly inherited = computed<DocumentVisibility>(() =>
    this.folders().find(f => f.id === this.folderId())?.effectiveVisibility ?? 'MANAGER');
  readonly inheritedLabel = computed(() => VISIBILITY_LABEL[this.inherited()]);
  readonly effective = computed(() => this.visibility() ?? this.inherited());
  readonly hint = computed(() => VISIBILITY_HINT[this.effective()]);
  readonly opensToOwners = computed(() => this.effective() === 'OWNERS' || this.effective() === 'PROPERTY');
  readonly pendingCount = computed(() => this.queue().filter(q => q.status === 'pending' || q.status === 'error').length);
  readonly finished = computed(() => this.queue().length > 0 && this.queue().every(q => q.status === 'done'));
  readonly canUpload = computed(() => this.pendingCount() > 0 && (this.visibility() !== 'PROPERTY' || !!this.propertyId()));

  ngOnInit(): void {
    this.folderId.set(this.initialFolderId());
  }

  stateLabel(q: QueuedFile): string {
    if (q.status === 'uploading') return 'Subiendo…';
    if (q.status === 'done') return 'Subido';
    if (q.status === 'error') return q.error ?? 'Error';
    return `${(q.file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(Array.from(input.files ?? []));
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  remove(item: QueuedFile): void {
    this.queue.update(list => list.filter(q => q !== item));
  }

  private add(files: File[]): void {
    this.error.set(null);
    const added = files.map<QueuedFile>(file => file.size > MAX_BYTES
      ? { file, status: 'error', error: 'Supera los 10 MB' }
      : { file, status: 'pending' });
    this.queue.update(list => [...list.filter(q => q.status !== 'done'), ...added]);
  }

  async upload(): Promise<void> {
    if (!this.canUpload() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    let count = 0;
    for (const item of this.queue()) {
      if (item.status === 'done' || item.file.size > MAX_BYTES) continue;
      this.patch(item, { status: 'uploading', error: undefined });
      try {
        await this.library.upload(this.estateId(), item.file, {
          folderId: this.folderId(),
          type: this.type(),
          visibility: this.visibility(),
          targetPropertyId: this.visibility() === 'PROPERTY' ? this.propertyId() : null,
        });
        this.patch(item, { status: 'done' });
        count++;
      } catch (err) {
        this.patch(item, { status: 'error', error: messageFrom(err, 'No se pudo subir') });
      }
    }
    this.busy.set(false);
    if (count) this.uploaded.emit(count);
    if (this.queue().some(q => q.status === 'error')) this.error.set('Algunos ficheros no se subieron. Revisa el motivo junto a cada uno.');
  }

  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  private patch(item: QueuedFile, change: Partial<QueuedFile>): void {
    Object.assign(item, change);
    this.queue.update(list => [...list]);
  }
}

export function messageFrom(err: unknown, fallback: string): string {
  const message = (err as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}
