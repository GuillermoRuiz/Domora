import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

/** Fetches the file through the authenticated client (never a URL carrying a token). */
export type BlobLoader = () => Promise<Blob>;

/**
 * The only types rendered inline. Anything else (SVG, HTML, XML, text, office files…) is never
 * rendered: an SVG or HTML blob would run with the app's origin.
 */
export const INLINE_PREVIEW_TYPES: readonly string[] = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export function canPreviewInline(mimeType: string | null | undefined): boolean {
  return INLINE_PREVIEW_TYPES.includes(normalizeMime(mimeType));
}

export function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Shared document preview (manager library dialog and owner «Documentación»). PDFs render in an
 * iframe from a blob: URL (nginx CSP allows `frame-src blob:`); PNG/JPEG/WebP use a data: URL
 * (already allowed by `img-src`). The blob is re-typed with the declared type, since the server
 * may answer `application/octet-stream`. Object URLs are revoked on input change and on destroy.
 */
@Component({
  selector: 'app-document-viewer',
  standalone: true,
  template: `
    <div class="viewer">
      @switch (state()) {
        @case ('loading') {
          <p class="viewer__note" data-viewer-loading>Cargando…</p>
        }
        @case ('error') {
          <p class="viewer__note" role="alert">No se pudo abrir el documento.</p>
        }
        @case ('unsupported') {
          <p class="viewer__note" data-viewer-unsupported>Vista previa no disponible. Descarga el documento para abrirlo.</p>
        }
        @default {
          @if (pdfUrl(); as url) {
            <iframe class="viewer__frame" [src]="url" [title]="title()"></iframe>
          } @else if (imageUrl(); as url) {
            <img class="viewer__image" [src]="url" [alt]="title()" />
          }
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .viewer { min-height: var(--viewer-min-height, 320px); display: flex; align-items: center; justify-content: center; overflow: auto;
      background: var(--color-surface-hover); border-radius: var(--radius-md); }
    .viewer__frame { width: 100%; height: var(--viewer-height, 70vh); border: none; border-radius: var(--radius-md); background: #fff; }
    .viewer__image { max-width: 100%; max-height: var(--viewer-height, 70vh); object-fit: contain; }
    .viewer__note { margin: 24px; font-size: 14px; color: var(--color-muted); text-align: center; }
  `],
})
export class DocumentViewerComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly loader = input.required<BlobLoader>();
  readonly mimeType = input<string | null>(null);
  readonly title = input.required<string>();

  readonly state = signal<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  private readonly blobUrl = signal<string | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly pdfUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.blobUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  private seq = 0;

  constructor() {
    effect(() => {
      const loader = this.loader();
      const mime = normalizeMime(this.mimeType());
      untracked(() => void this.load(loader, mime));
    });
    inject(DestroyRef).onDestroy(() => {
      this.seq++;
      this.release();
    });
  }

  private async load(loader: BlobLoader, mime: string): Promise<void> {
    const seq = ++this.seq;
    this.release();
    this.imageUrl.set(null);
    if (!INLINE_PREVIEW_TYPES.includes(mime)) {
      this.state.set('unsupported');
      return;
    }
    this.state.set('loading');
    try {
      const typed = new Blob([await loader()], { type: mime });
      if (seq !== this.seq) return;
      if (mime === 'application/pdf') {
        this.blobUrl.set(URL.createObjectURL(typed));
      } else {
        const dataUrl = await toDataUrl(typed);
        if (seq !== this.seq) return;
        this.imageUrl.set(dataUrl);
      }
      this.state.set('ready');
    } catch {
      if (seq === this.seq) this.state.set('error');
    }
  }

  private release(): void {
    const url = this.blobUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrl.set(null);
    }
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
