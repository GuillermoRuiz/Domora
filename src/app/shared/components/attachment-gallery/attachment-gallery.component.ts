import { Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** A stored file of an issue (photo or document). */
export interface GalleryAttachment {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  size?: number | null;
}

const isImage = (a: GalleryAttachment) => !!a.mimeType?.startsWith('image/');

/**
 * Attachments as thumbnails: images are fetched through `loader` (authenticated
 * blobs) and shown from object URLs, revoked when they leave or on destroy;
 * any other file is a tile with its name. Clicking any of them emits
 * `download`. With `canAdd`, a drop tile lets the user pick or drop files and
 * emits them (validation and upload are the caller's).
 */
@Component({
  selector: 'app-attachment-gallery',
  standalone: true,
  imports: [IconComponent],
  template: `
    <ul class="gallery">
      @for (a of attachments(); track a.id) {
        <li>
          <button type="button" class="gallery__tile" [attr.data-attachment]="a.id" [attr.aria-label]="'Descargar ' + (a.fileName ?? 'archivo')" [title]="a.fileName ?? ''" (click)="download.emit(a)">
            @if (urls()[a.id]; as url) {
              <img [src]="url" [alt]="a.fileName ?? 'Imagen adjunta'" />
            } @else {
              <span class="gallery__file">
                <app-icon [name]="isImage(a) ? 'image' : 'file-text'" [size]="22"></app-icon>
                <span class="gallery__name">{{ a.fileName ?? 'Archivo' }}</span>
              </span>
            }
          </button>
        </li>
      }
      @if (canAdd()) {
        <li>
          <label class="gallery__tile gallery__add" data-add-files [class.gallery__add--over]="dragOver()"
            (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
            <input type="file" multiple [accept]="accept()" (change)="onPick($event)" />
            <app-icon name="upload" [size]="20"></app-icon>
            <span class="gallery__add-label">{{ addLabel() }}</span>
            <span class="gallery__hint">{{ hint() }}</span>
          </label>
        </li>
      }
    </ul>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .gallery__tile {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      aspect-ratio: 1;
      padding: 0;
      overflow: hidden;
      font: inherit;
      color: var(--color-muted);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
    }
    .gallery__tile:hover { border-color: var(--color-accent); }
    .gallery__tile:focus-visible, .gallery__add:focus-within { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .gallery__tile img { width: 100%; height: 100%; object-fit: cover; }
    .gallery__file { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; min-width: 0; max-width: 100%; }
    .gallery__name { max-width: 100%; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gallery__add { flex-direction: column; gap: 4px; padding: 8px; text-align: center; border-style: dashed; }
    .gallery__add--over { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
    .gallery__add input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .gallery__add-label { font-size: 12.5px; font-weight: 600; color: var(--color-text); }
    .gallery__hint { font-size: 11px; line-height: 1.3; }
  `],
})
export class AttachmentGalleryComponent {
  readonly attachments = input<GalleryAttachment[]>([]);
  /** Fetches the file of an attachment; without it images show as file tiles. */
  readonly loader = input<((attachment: GalleryAttachment) => Promise<Blob>) | null>(null);
  readonly canAdd = input(false);
  readonly accept = input('image/*,application/pdf');
  readonly addLabel = input('Añadir archivos');
  readonly hint = input('JPG, PNG o PDF (máx. 10 MB)');

  readonly filesSelected = output<File[]>();
  readonly download = output<GalleryAttachment>();

  /** Object URL per image attachment id. */
  readonly urls = signal<Record<string, string>>({});
  readonly dragOver = signal(false);
  readonly isImage = isImage;
  private requested = new Set<string>();
  private destroyed = false;

  constructor() {
    effect(() => {
      const attachments = this.attachments();
      const loader = this.loader();
      untracked(() => this.sync(attachments, loader));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const url of Object.values(this.urls())) URL.revokeObjectURL(url);
    });
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.filesSelected.emit(files);
    try {
      input.value = '';
    } catch {
      // Some environments do not allow resetting a file input; picking the same file again is then a no-op.
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) this.filesSelected.emit(files);
  }

  private sync(attachments: GalleryAttachment[], loader: ((a: GalleryAttachment) => Promise<Blob>) | null): void {
    const keep = new Set(attachments.map((a) => a.id));
    const current = { ...this.urls() };
    let changed = false;
    for (const [id, url] of Object.entries(current)) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(url);
        delete current[id];
        this.requested.delete(id);
        changed = true;
      }
    }
    if (changed) this.urls.set(current);
    if (!loader) return;
    for (const a of attachments) {
      if (!isImage(a) || this.requested.has(a.id)) continue;
      this.requested.add(a.id);
      loader(a)
        .then((blob) => {
          const url = URL.createObjectURL(new Blob([blob], { type: a.mimeType ?? 'image/*' }));
          if (this.destroyed || !this.requested.has(a.id)) {
            URL.revokeObjectURL(url);
            return;
          }
          this.urls.update((urls) => ({ ...urls, [a.id]: url }));
        })
        .catch(() => {
          // The tile stays as a file icon; downloading it can still be tried.
          this.requested.delete(a.id);
        });
    }
  }
}
