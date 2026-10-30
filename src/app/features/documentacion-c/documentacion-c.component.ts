import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { downloadErrorMessage } from '../../core/document-library.service';
import { saveBlob } from '../../core/file-download';
import {
  OWNER_DOCUMENT_CATEGORIES,
  OWNER_DOCUMENT_FILE_TYPES,
  categoryInfo,
  type OwnerDocument,
  type OwnerDocumentCategory,
  type OwnerDocumentFileType,
  type OwnerDocumentList,
  type OwnerDocumentSort,
} from '../../core/owner-documents.models';
import { OwnerDocumentsService } from '../../core/owner-documents.service';
import { OwnerScopeService } from '../../core/owner-scope.service';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { canPreviewInline, normalizeMime } from '../../shared/components/document-viewer/document-viewer.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CommunityScopeSelectorComponent } from '../community-c/community-scope-selector/community-scope-selector.component';
import { OwnerDocumentDetailComponent } from './document-detail/document-detail.component';
import { fileIcon, formatDay } from './document-helpers';

interface Filters {
  from: string;
  to: string;
  fileType: '' | OwnerDocumentFileType;
  onlyNew: boolean;
  /** Only in «Todas mis propiedades». */
  propertyId: string;
}

type SortColumn = 'name' | 'date' | 'size';

const NO_FILTERS: Filters = { from: '', to: '', fileType: '', onlyNew: false, propertyId: '' };
const SEARCH_DELAY_MS = 300;
/** How long a blob opened in a new tab stays alive (the tab has loaded it by then). */
const OPENED_URL_TTL_MS = 60_000;
const PHONE_QUERY = '(max-width: 760px)';
/** Most ids `POST /me/documents/read` accepts per request (`MarkOwnerDocumentsReadDto`). */
const MARK_READ_BATCH = 200;

/**
 * «Documentación» of the owner (role C): the community documents published for them, with
 * search, filters, category chips, a sortable table and the detail of the chosen one (deep link
 * `?doc=<id>`). The scope follows the property chosen in the header, like «Incidencias».
 * Spec: odd/tasks/owner-documents.md (S1-S4).
 */
@Component({
  selector: 'app-documentacion-c',
  standalone: true,
  imports: [TopbarComponent, CommunityScopeSelectorComponent, IconComponent, EmptyStateComponent, OwnerDocumentDetailComponent],
  templateUrl: './documentacion-c.component.html',
  styleUrl: './documentacion-c.component.scss',
})
export class DocumentacionCComponent {
  readonly scope = inject(OwnerScopeService);
  private state = inject(StateService);
  private api = inject(OwnerDocumentsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private filtersBox = viewChild<ElementRef<HTMLElement>>('filtersBox');

  readonly categories = OWNER_DOCUMENT_CATEGORIES;
  readonly fileTypes = OWNER_DOCUMENT_FILE_TYPES;
  readonly categoryInfo = categoryInfo;
  readonly formatDay = formatDay;
  readonly fileIcon = fileIcon;

  readonly list = signal<OwnerDocumentList | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly searchText = signal('');
  private readonly query = signal('');
  readonly category = signal<'' | OwnerDocumentCategory>('');
  readonly filters = signal<Filters>(NO_FILTERS);
  readonly filtersOpen = signal(false);
  readonly sort = signal<OwnerDocumentSort>('date_desc');
  readonly selectedId = signal<string | null>(null);
  readonly menuId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly notice = signal<string | null>(null);
  readonly phone = signal(false);

  readonly showPropertyFilter = computed(() => this.scope.isAll());
  readonly activeFilters = computed(() => {
    const f = this.filters();
    return [f.from, f.to, f.fileType, f.onlyNew, this.showPropertyFilter() && f.propertyId].filter(Boolean).length;
  });
  readonly rows = computed<OwnerDocument[]>(() => this.list()?.items ?? []);
  readonly newIds = computed(() => this.rows().filter((d) => d.isNew).map((d) => d.id));
  readonly selectedDoc = computed(() => {
    const id = this.selectedId();
    return id ? this.rows().find((d) => d.id === id) ?? null : null;
  });
  readonly scopeName = computed(() => (this.scope.isAll() ? 'Todas mis propiedades' : this.scope.selected()?.estateName ?? 'Sin comunidad vinculada'));
  /** In «Todas» with homes in several estates, each row says which community it belongs to. */
  readonly showEstate = computed(() => this.scope.isAll() && new Set(this.scope.items().map((p) => p.estateId)).size > 1);
  readonly emptyTitle = computed(() => {
    const category = this.category();
    if (category) return `No hay documentos de ${categoryInfo(category).label} todavía`;
    return this.activeFilters() > 0 || this.query() ? 'No hay documentos que coincidan' : 'Todavía no hay documentos';
  });
  readonly emptyHint = computed(() =>
    this.activeFilters() > 0 || this.query()
      ? 'Prueba con otra búsqueda o limpia los filtros.'
      : 'Cuando la administración publique documentos para tu comunidad, aparecerán aquí.',
  );

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private listSeq = 0;
  /** Documents already marked on opening (a refused mark is not retried in a loop). */
  private readonly autoMarked = new Set<string>();

  constructor() {
    // `?onlyNew=1` (the «Mi comunidad» «Documentos nuevos» KPI) opens the page with that filter on.
    if (this.route.snapshot.queryParamMap.get('onlyNew') === '1') this.filters.set({ ...NO_FILTERS, onlyNew: true });
    effect(() => {
      this.state.propertiesVersion();
      void this.scope.load();
    });
    // The list follows the scope, the search, the category, the filters and the order.
    effect(() => {
      const ready = this.scope.loaded() && this.scope.items().length > 0;
      this.scope.isAll();
      this.scope.selected();
      this.query();
      this.category();
      this.filters();
      this.sort();
      untracked(() => {
        if (ready) void this.reload();
      });
    });
    // Opening a document marks it as read.
    effect(() => {
      const doc = this.selectedDoc();
      if (!doc?.isNew || this.autoMarked.has(doc.id)) return;
      this.autoMarked.add(doc.id);
      untracked(() => void this.markRead([doc.id]));
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => this.selectedId.set(params.get('doc')));
    this.watchPhone();
  }

  async reload(): Promise<void> {
    const seq = ++this.listSeq;
    const f = this.filters();
    const propertyId = this.scope.isAll() ? f.propertyId || undefined : this.scope.selected()?.id;
    this.loading.set(true);
    try {
      const list = await this.api.list({
        propertyId,
        q: this.query() || undefined,
        category: this.category() || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        fileType: f.fileType || undefined,
        onlyNew: f.onlyNew || undefined,
        sort: this.sort(),
      });
      if (seq !== this.listSeq) return;
      this.list.set(list);
      this.failed.set(false);
    } catch {
      if (seq === this.listSeq) this.failed.set(true);
    } finally {
      if (seq === this.listSeq) this.loading.set(false);
    }
  }

  onSearch(text: string): void {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.query.set(text.trim()), SEARCH_DELAY_MS);
  }

  setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
  }

  clearFilters(): void {
    this.filters.set(NO_FILTERS);
  }

  chooseCategory(category: '' | OwnerDocumentCategory): void {
    this.category.set(category);
  }

  categoryCount(key: 'all' | OwnerDocumentCategory): number | null {
    return this.list()?.counts[key] ?? null;
  }

  sortBy(column: SortColumn): void {
    const current = this.sort();
    if (column === 'date') this.sort.set(current === 'date_desc' ? 'date_asc' : 'date_desc');
    else this.sort.set(column === 'name' ? 'name_asc' : 'size_desc');
  }

  ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
    const sort = this.sort();
    if (column === 'date') return sort === 'date_asc' ? 'ascending' : sort === 'date_desc' ? 'descending' : 'none';
    if (column === 'name') return sort === 'name_asc' ? 'ascending' : 'none';
    return sort === 'size_desc' ? 'descending' : 'none';
  }

  propertyLabel(p: { nickname?: string | null; addressFull?: string | null; estateName?: string | null }): string {
    const name = p.nickname || p.addressFull || 'Propiedad';
    return p.estateName ? `${name} · ${p.estateName}` : name;
  }

  openDoc(id: string): void {
    this.menuId.set(null);
    this.selectedId.set(id);
    this.syncQuery(id);
  }

  onRowKey(event: Event, id: string): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.openDoc(id);
  }

  closeDoc(): void {
    this.selectedId.set(null);
    this.syncQuery(null);
  }

  toggleMenu(event: Event, id: string): void {
    event.stopPropagation();
    this.menuId.update((open) => (open === id ? null : id));
  }

  async markAllRead(): Promise<void> {
    this.notice.set(null);
    if (!(await this.markRead(this.newIds()))) {
      this.notice.set('No se pudieron marcar todos los documentos como leídos. Inténtalo de nuevo.');
    }
  }

  async download(doc: OwnerDocument): Promise<void> {
    this.menuId.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      const blob = await this.api.file(doc.id, 'download');
      await saveBlob(new Blob([blob], { type: doc.mimeType || blob.type }), doc.title);
      if (doc.isNew) void this.markRead([doc.id]);
    } catch (err) {
      this.notice.set(await downloadErrorMessage(err, 'No se pudo descargar el documento. Inténtalo de nuevo.'));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Opens the authenticated blob in a new tab. Only PDF and PNG/JPEG/WebP are opened inline: any
   * other type (SVG, HTML…) would run with the app's origin, so it is downloaded instead.
   */
  async openInNewTab(doc: OwnerDocument): Promise<void> {
    if (!canPreviewInline(doc.mimeType)) {
      await this.download(doc);
      return;
    }
    this.menuId.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      const blob = await this.api.file(doc.id, 'view');
      const url = URL.createObjectURL(new Blob([blob], { type: normalizeMime(doc.mimeType) }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), OPENED_URL_TTL_MS);
      if (doc.isNew) void this.markRead([doc.id]);
    } catch (err) {
      this.notice.set(await downloadErrorMessage(err, 'No se pudo abrir el documento. Inténtalo de nuevo.'));
    } finally {
      this.busy.set(false);
    }
  }

  async copyLink(doc: OwnerDocument): Promise<void> {
    this.menuId.set(null);
    const path = this.router.serializeUrl(this.router.createUrlTree(['/c/documentacion'], { queryParams: { doc: doc.id } }));
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      this.notice.set('Enlace copiado. Solo podrá abrirlo quien tenga acceso a este documento.');
    } catch {
      this.notice.set('No se pudo copiar el enlace.');
    }
  }

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.menuId()) this.menuId.set(null);
    if (!this.filtersOpen()) return;
    const box = this.filtersBox()?.nativeElement;
    if (box && event.target instanceof Node && !box.contains(event.target)) this.filtersOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuId()) this.menuId.set(null);
    else if (this.filtersOpen()) this.filtersOpen.set(false);
    else if (this.phone() && this.selectedId()) this.closeDoc();
  }

  /**
   * Marks as read and clears the «Nuevo» pills right away. Sent in batches of
   * MARK_READ_BATCH (the server's `@ArrayMaxSize`); if a batch is refused, the
   * pills of that batch and the ones not sent yet come back. Returns whether
   * every id was marked.
   */
  private async markRead(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    this.setNew(new Set(ids), false);
    for (let start = 0; start < ids.length; start += MARK_READ_BATCH) {
      try {
        await this.api.markRead(ids.slice(start, start + MARK_READ_BATCH));
      } catch {
        this.setNew(new Set(ids.slice(start)), true);
        return false;
      }
    }
    return true;
  }

  private setNew(ids: Set<string>, isNew: boolean): void {
    this.list.update((list) => (list ? { ...list, items: list.items.map((d) => (ids.has(d.id) ? { ...d, isNew } : d)) } : list));
  }

  private syncQuery(docId: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { doc: docId }, queryParamsHandling: 'merge' });
  }

  private watchPhone(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(PHONE_QUERY);
    this.phone.set(media.matches);
    const onChange = (e: MediaQueryListEvent) => this.phone.set(e.matches);
    media.addEventListener?.('change', onChange);
    inject(DestroyRef).onDestroy(() => media.removeEventListener?.('change', onChange));
  }
}
