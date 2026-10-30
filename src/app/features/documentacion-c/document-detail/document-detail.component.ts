import { Component, ElementRef, afterNextRender, computed, inject, input, output, viewChild } from '@angular/core';
import { categoryInfo, fileTypeLabel, type OwnerDocument } from '../../../core/owner-documents.models';
import { OwnerDocumentsService } from '../../../core/owner-documents.service';
import { DocumentViewerComponent } from '../../../shared/components/document-viewer/document-viewer.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { fileIcon, formatDay } from '../document-helpers';

/**
 * Right panel of «Documentación» (full screen on phones, with dialog semantics there): the
 * document data, the shared viewer (PDF and images only) and «Descargar» / «Abrir documento».
 * The page owns the file actions (they are shared with the row menu).
 */
@Component({
  selector: 'app-owner-document-detail',
  standalone: true,
  imports: [IconComponent, DocumentViewerComponent],
  templateUrl: './document-detail.component.html',
  styleUrl: './document-detail.component.scss',
})
export class OwnerDocumentDetailComponent {
  private readonly api = inject(OwnerDocumentsService);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  /** null: the linked document is not in the current list. */
  readonly document = input<OwnerDocument | null>(null);
  /** Phones: the panel covers the screen and behaves as a modal dialog. */
  readonly modal = input(false);
  readonly busy = input(false);

  readonly closed = output<void>();
  readonly download = output<OwnerDocument>();
  readonly open = output<OwnerDocument>();

  readonly formatDay = formatDay;
  readonly fileIcon = fileIcon;

  readonly category = computed(() => {
    const doc = this.document();
    return doc ? categoryInfo(doc.category) : null;
  });
  readonly typeAndSize = computed(() => {
    const doc = this.document();
    return doc ? `${fileTypeLabel(doc.fileType)} · ${doc.size}` : '';
  });
  /** The viewer fetches the file as a `view` (audited apart from downloads). */
  readonly loader = computed(() => {
    const id = this.document()?.id;
    return () => (id ? this.api.file(id, 'view') : Promise.reject(new Error('no document')));
  });

  constructor() {
    // On phones the full-screen dialog takes the focus.
    afterNextRender(() => {
      if (this.modal()) this.closeBtn()?.nativeElement.focus();
    });
  }
}
