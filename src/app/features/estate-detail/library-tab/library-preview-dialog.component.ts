import { Component, computed, inject, input, output } from '@angular/core';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { DocumentViewerComponent } from '../../../shared/components/document-viewer/document-viewer.component';
import { DocumentLibraryService, type LibraryDocument } from '../../../core/document-library.service';

/**
 * In-app preview of a library document; the rendering (PDF/PNG/JPEG/WebP only) is the shared
 * `app-document-viewer`. Anything else offers the download.
 */
@Component({
  selector: 'app-library-preview-dialog',
  standalone: true,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  imports: [BtnComponent, IconComponent, DocumentViewerComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div class="modal--preview" role="dialog" aria-modal="true" aria-labelledby="lp-title" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <div>
            <h4 id="lp-title">{{ document().title }}</h4>
            <p class="subtitle">{{ document().type }} · {{ document().size }}</p>
          </div>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <app-document-viewer class="preview" [loader]="loader()" [mimeType]="document().mimeType" [title]="document().title"></app-document-viewer>
        <div class="modal__footer">
          <app-btn variant="outline" (clicked)="closed.emit()">Cerrar</app-btn>
          <app-btn variant="accent" (clicked)="download.emit(document())"><app-icon name="download" [size]="14"></app-icon> Descargar</app-btn>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./library-dialog.scss'],
  styles: [`.preview { flex: 1; }`],
})
export class LibraryPreviewDialogComponent {
  private readonly library = inject(DocumentLibraryService);

  readonly document = input.required<LibraryDocument>();
  readonly download = output<LibraryDocument>();
  readonly closed = output<void>();

  /** The preview is audited as a `view`; the footer button downloads. */
  readonly loader = computed(() => {
    const id = this.document().id;
    return () => this.library.file(id, 'view');
  });
}
