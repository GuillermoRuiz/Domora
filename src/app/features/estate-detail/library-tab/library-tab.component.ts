import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import type { OwnerProperty } from '../../../core/models';
import {
  DocumentLibraryService, VISIBILITY_LABEL, downloadErrorMessage,
  type DocumentVisibility, type FolderVisibility, type LibraryDocument, type LibraryFolder, type LibraryListing,
} from '../../../core/document-library.service';
import { LibraryVisibilityDialogComponent, type VisibilityChoice, type VisibilityTarget } from './library-visibility-dialog.component';
import { LibraryUploadDialogComponent, messageFrom } from './library-upload-dialog.component';
import { LibraryNameDialogComponent, type NameDialogMode, type NameDialogResult } from './library-name-dialog.component';
import { LibraryPreviewDialogComponent } from './library-preview-dialog.component';
import { PREVIEWABLE, fileKind, folderPath, folderTree } from './library-tree';

type View = 'folder' | 'search' | 'trash' | 'review';
type Menu = { kind: 'folder'; item: LibraryFolder } | { kind: 'document'; item: LibraryDocument };
type Dialog =
  | { kind: 'upload' }
  | { kind: 'name'; mode: NameDialogMode; apply: (result: NameDialogResult) => Promise<unknown> }
  | { kind: 'visibility'; target: VisibilityTarget; apply: (choice: VisibilityChoice) => Promise<unknown> }
  | { kind: 'preview'; document: LibraryDocument };

const OWNER_FACING: DocumentVisibility[] = ['OWNERS', 'PROPERTY'];
const MENU_WIDTH = 240;

/**
 * «Documentos» tab of the estate (rol B): folders with inherited visibility, uploads,
 * signed actas and the owner preview. Spec: odd/tasks/documentos-finca.md (T4/T5).
 */
@Component({
  selector: 'app-library-tab',
  standalone: true,
  host: { '(document:keydown.escape)': 'closeMenu()' },
  imports: [DatePipe, FormsModule, BtnComponent, IconComponent, PageActionDirective,
    LibraryVisibilityDialogComponent, LibraryUploadDialogComponent, LibraryNameDialogComponent, LibraryPreviewDialogComponent],
  templateUrl: './library-tab.component.html',
  styleUrl: './library-tab.component.scss',
})
export class LibraryTabComponent implements OnInit {
  private readonly library = inject(DocumentLibraryService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly estateId = input.required<string>();
  readonly properties = input<OwnerProperty[]>([]);
  /** Owner name by propertyId, already loaded by estate-detail. */
  readonly titularByProperty = input<Record<string, string>>({});

  readonly listing = signal<LibraryListing | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly view = signal<View>('folder');
  readonly folderId = signal<string | null>(null);
  readonly query = signal('');
  readonly ownerPreview = signal(false);
  readonly menu = signal<Menu | null>(null);
  readonly menuPosition = signal({ top: 0, left: 0 });
  readonly dialog = signal<Dialog | null>(null);
  readonly dialogBusy = signal(false);
  readonly dialogError = signal<string | null>(null);
  readonly toast = signal<string | null>(null);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private loadSeq = 0;

  readonly folders = computed(() => this.listing()?.folders ?? []);
  readonly tree = computed(() => {
    const all = folderTree(this.folders());
    return this.ownerPreview() ? all.filter(f => (f.ownerDocumentCount ?? 0) > 0) : all;
  });
  readonly breadcrumbs = computed(() => folderPath(this.folders(), this.folderId()));
  readonly currentFolder = computed(() => this.folders().find(f => f.id === this.folderId()) ?? null);
  readonly subfolders = computed(() => this.view() !== 'folder' ? [] : this.folders()
    .filter(f => f.parentId === this.folderId())
    .filter(f => !this.ownerPreview() || (f.ownerDocumentCount ?? 0) > 0));
  /** Filters on the current view (folder, search, trash or review): '' = all. */
  readonly filterType = signal('');
  readonly filterAudience = signal<DocumentVisibility | ''>('');
  readonly filterSource = signal<'upload' | 'generated' | ''>('');
  readonly filtering = computed(() => !!(this.filterType() || this.filterAudience() || this.filterSource()));
  /** Documents of the current view before the filters (their types feed the «Tipo» filter). */
  private readonly viewDocuments = computed(() => {
    const docs = this.listing()?.documents ?? [];
    return this.ownerPreview() && this.view() !== 'trash'
      ? docs.filter(d => OWNER_FACING.includes(d.effectiveVisibility ?? 'MANAGER'))
      : docs;
  });
  readonly typeOptions = computed(() => [...new Set(this.viewDocuments().map(d => d.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')));
  readonly audienceOptions: DocumentVisibility[] = ['MANAGER', 'BOARD', 'OWNERS', 'PROPERTY'];
  readonly documents = computed(() => this.viewDocuments().filter(d =>
    (!this.filterType() || d.type === this.filterType())
    && (!this.filterAudience() || (d.effectiveVisibility ?? 'MANAGER') === this.filterAudience())
    && (!this.filterSource() || d.source === this.filterSource())));
  readonly pendingReview = computed(() => this.listing()?.pendingReview ?? 0);
  readonly inTrash = computed(() => this.listing()?.inTrash ?? 0);
  readonly rootCount = computed(() => this.ownerPreview() ? this.listing()?.rootOwnerDocumentCount ?? 0 : this.listing()?.rootDocumentCount ?? 0);
  readonly propertyOptions = computed(() => this.properties().map(p => ({ id: p.id, label: this.propertyLabel(p.id) })));
  readonly isEmpty = computed(() => !this.shownFolders().length && !this.documents().length);
  /** Folders are hidden while filtering: the filters apply to documents. */
  readonly shownFolders = computed(() => this.filtering() ? [] : this.subfolders());
  readonly heading = computed(() => {
    switch (this.view()) {
      case 'search': return `Resultados de «${this.query().trim()}»`;
      case 'trash': return 'Papelera';
      case 'review': return 'Pendientes de revisar';
      default: return this.currentFolder()?.name ?? 'Todos los documentos';
    }
  });

  readonly visibilityLabel = (v: DocumentVisibility | undefined) => VISIBILITY_LABEL[v ?? 'MANAGER'];
  readonly kind = (d: LibraryDocument) => fileKind(d.mimeType, d.title);
  readonly canPreview = (d: LibraryDocument) => PREVIEWABLE(d.mimeType);
  readonly folderCount = (f: LibraryFolder) => this.ownerPreview() ? f.ownerDocumentCount ?? 0 : f.documentCount;

  clearFilters(): void {
    this.filterType.set('');
    this.filterAudience.set('');
    this.filterSource.set('');
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const view = this.view();
      const listing = await this.library.list(this.estateId(), view === 'search'
        ? { q: this.query() }
        : view === 'trash' || view === 'review' ? { view } : { folderId: this.folderId() });
      if (seq !== this.loadSeq) return;
      this.listing.set(listing);
      this.loadError.set(null);
      // A folder that disappeared (deleted elsewhere) falls back to the root.
      if (this.folderId() && !listing.folders.some(f => f.id === this.folderId())) this.openFolder(null);
    } catch (err) {
      if (seq === this.loadSeq) this.loadError.set(messageFrom(err, 'No se pudieron cargar los documentos.'));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────
  openFolder(folderId: string | null): void {
    this.clearFilters();
    this.query.set('');
    this.view.set('folder');
    this.folderId.set(folderId);
    void this.load();
  }

  openView(view: 'trash' | 'review'): void {
    this.clearFilters();
    this.ownerPreview.set(false);
    this.query.set('');
    this.view.set(view);
    void this.load();
  }

  onSearch(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      if (value.trim()) { this.view.set('search'); void this.load(); }
      else if (this.view() === 'search') this.openFolder(this.folderId());
    }, 250);
  }

  toggleOwnerPreview(): void {
    this.ownerPreview.update(on => !on);
    if (this.ownerPreview() && (this.view() === 'trash' || this.view() === 'review')) this.openFolder(this.folderId());
  }

  // ── Row menus ───────────────────────────────────────────────────────
  openMenu(event: MouseEvent, menu: Menu): void {
    event.stopPropagation();
    const current = this.menu();
    if (current && current.item.id === menu.item.id) { this.menu.set(null); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPosition.set({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)) });
    this.menu.set(menu);
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  // ── Dialogs ─────────────────────────────────────────────────────────
  private open(dialog: Dialog): void {
    this.menu.set(null);
    this.dialogError.set(null);
    this.dialogBusy.set(false);
    this.dialog.set(dialog);
  }

  closeDialog(): void {
    if (!this.dialogBusy()) this.dialog.set(null);
  }

  openUpload(): void {
    this.open({ kind: 'upload' });
  }

  onUploaded(count: number): void {
    this.flash(count === 1 ? 'Documento subido' : `${count} documentos subidos`);
    void this.load();
  }

  newFolder(parentId: string | null = this.view() === 'folder' ? this.folderId() : null): void {
    this.open({
      kind: 'name', mode: { kind: 'create', parentId },
      apply: async ({ name }) => {
        await this.library.createFolder(this.estateId(), { name: name!, parentId });
        this.flash('Carpeta creada');
      },
    });
  }

  renameFolder(folder: LibraryFolder): void {
    this.open({
      kind: 'name', mode: { kind: 'rename', target: 'folder', current: folder.name },
      apply: async ({ name }) => {
        await this.library.updateFolder(this.estateId(), folder.id, { name });
        this.flash('Carpeta renombrada');
      },
    });
  }

  moveFolder(folder: LibraryFolder): void {
    this.open({
      kind: 'name', mode: { kind: 'move', target: 'folder', name: folder.name, currentFolderId: folder.parentId, folderId: folder.id },
      apply: async ({ folderId }) => {
        await this.library.updateFolder(this.estateId(), folder.id, { parentId: folderId ?? null });
        this.flash('Carpeta movida');
      },
    });
  }

  renameDocument(doc: LibraryDocument): void {
    this.open({
      kind: 'name', mode: { kind: 'rename', target: 'document', current: doc.title },
      apply: async ({ name }) => {
        await this.library.updateDocument(this.estateId(), doc.id, { title: name });
        this.flash('Documento renombrado');
      },
    });
  }

  moveDocument(doc: LibraryDocument): void {
    this.open({
      kind: 'name', mode: { kind: 'move', target: 'document', name: doc.title, currentFolderId: doc.folderId },
      apply: async ({ folderId }) => {
        await this.library.updateDocument(this.estateId(), doc.id, { folderId: folderId ?? null });
        this.flash('Documento movido');
      },
    });
  }

  folderVisibility(folder: LibraryFolder): void {
    const parent = this.folders().find(f => f.id === folder.parentId);
    this.open({
      kind: 'visibility',
      target: { kind: 'folder', name: folder.name, visibility: folder.visibility ?? null, inherited: parent?.effectiveVisibility ?? null },
      apply: async ({ visibility }) => {
        await this.library.updateFolder(this.estateId(), folder.id, { visibility: visibility as FolderVisibility | null });
        this.flash('Visibilidad de la carpeta actualizada');
      },
    });
  }

  documentVisibility(doc: LibraryDocument): void {
    const folder = this.folders().find(f => f.id === doc.folderId);
    this.open({
      kind: 'visibility',
      target: {
        kind: 'document', name: doc.title, visibility: doc.visibility ?? null, targetPropertyId: doc.targetPropertyId,
        // Root documents have no folder to inherit from: the most restrictive level applies.
        inherited: folder?.effectiveVisibility ?? 'MANAGER',
        inheritsDefault: !folder,
      },
      apply: async ({ visibility, targetPropertyId }) => {
        await this.library.updateDocument(this.estateId(), doc.id, { visibility, targetPropertyId });
        this.flash('Visibilidad del documento actualizada');
      },
    });
  }

  preview(doc: LibraryDocument): void {
    this.open({ kind: 'preview', document: doc });
  }

  async submitDialog(result: NameDialogResult | VisibilityChoice): Promise<void> {
    const dialog = this.dialog();
    if (!dialog || !('apply' in dialog) || this.dialogBusy()) return;
    this.dialogBusy.set(true);
    this.dialogError.set(null);
    try {
      await (dialog.apply as (r: typeof result) => Promise<unknown>)(result);
      this.dialogBusy.set(false);
      this.dialog.set(null);
      void this.load();
    } catch (err) {
      this.dialogBusy.set(false);
      const message = messageFrom(err, 'No se pudo guardar el cambio.');
      if (dialog.kind === 'name') this.dialogError.set(message);
      else { this.dialog.set(null); this.flash(message); }
    }
  }

  // ── Direct actions ──────────────────────────────────────────────────
  async download(doc: LibraryDocument): Promise<void> {
    this.menu.set(null);
    try {
      const blob = await this.library.file(doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.flash(await downloadErrorMessage(err, 'No se pudo descargar el documento'));
    }
  }

  async trash(doc: LibraryDocument): Promise<void> {
    this.menu.set(null);
    const ok = await this.confirm.ask({
      title: 'Enviar a la papelera',
      message: `«${doc.title}» dejará de verse en la biblioteca. Podrás restaurarlo desde la papelera.`,
      confirmLabel: 'Enviar a la papelera', tone: 'danger',
    });
    if (!ok) return;
    await this.run(() => this.library.trash(this.estateId(), doc.id), 'Documento enviado a la papelera');
  }

  async restore(doc: LibraryDocument): Promise<void> {
    await this.run(() => this.library.restore(this.estateId(), doc.id), 'Documento restaurado');
  }

  async deleteFolder(folder: LibraryFolder): Promise<void> {
    this.menu.set(null);
    const ok = await this.confirm.ask({
      title: 'Eliminar carpeta',
      message: `Se eliminará la carpeta «${folder.name}». Solo se pueden eliminar carpetas vacías.`,
      confirmLabel: 'Eliminar', tone: 'danger',
    });
    if (!ok) return;
    await this.run(() => this.library.deleteFolder(this.estateId(), folder.id), 'Carpeta eliminada');
  }

  /** Review: open one migrated document to every owner. */
  async openToOwners(doc: LibraryDocument): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Abrir a propietarios',
      message: `Todos los propietarios podrán ver «${doc.title}» y recibirán un aviso. Comprueba que no contiene datos personales de otros vecinos que no deban conocer.`,
      confirmLabel: 'Abrir a propietarios',
    });
    if (!ok) return;
    await this.run(() => this.library.updateDocument(this.estateId(), doc.id, { visibility: 'OWNERS' }), 'Documento abierto a propietarios');
  }

  async keepManagerOnly(docs: LibraryDocument[] | 'all'): Promise<void> {
    const all = docs === 'all';
    await this.run(
      () => this.library.markReviewed(this.estateId(), all ? [] : docs.map(d => d.id), all),
      all ? 'Todos quedan solo para la gestora' : 'Queda solo para la gestora',
    );
    if (all || !this.pendingReview()) this.openFolder(this.folderId());
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await action();
      this.flash(done);
    } catch (err) {
      this.flash(messageFrom(err, 'No se pudo completar la acción.'));
    }
    await this.load();
  }

  // ── Labels ──────────────────────────────────────────────────────────
  propertyLabel(propertyId: string | null): string {
    const p = this.properties().find(x => x.id === propertyId);
    if (!p) return 'Una propiedad';
    const where = [p.floor && `${p.floor}ª`, p.door && `${p.door}`, p.staircase && `esc. ${p.staircase}`].filter(Boolean).join(' ') || p.ref || 'Propiedad';
    const owner = this.titularByProperty()[p.id];
    return owner ? `${where} · ${owner}` : where;
  }

  audienceLabel(doc: LibraryDocument): string {
    return doc.effectiveVisibility === 'PROPERTY' ? this.propertyLabel(doc.targetPropertyId) : this.visibilityLabel(doc.effectiveVisibility);
  }

  private flash(message: string): void {
    this.toast.set(message);
    setTimeout(() => { if (this.toast() === message) this.toast.set(null); }, 2800);
  }
}
