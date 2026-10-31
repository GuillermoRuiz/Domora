import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import {
  OWNER_ISSUE_STATUS,
  OWNER_ISSUE_SUBTYPES,
  type OwnerIssueList,
  type OwnerIssueListItem,
  type OwnerIssueStatus,
} from '../../core/owner-issues.models';
import { OwnerIssuesService } from '../../core/owner-issues.service';
import { OwnerScopeService } from '../../core/owner-scope.service';
import { bindOwnerScopeToRoute } from '../../core/owner-scope-route';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { KpiTileComponent, type KpiIconTone } from '../../shared/components/kpi-tile/kpi-tile.component';
import { StatusPillComponent } from '../../shared/components/status-pill/status-pill.component';
import { CommunityScopeSelectorComponent } from '../community-c/community-scope-selector/community-scope-selector.component';
import { IssueDetailComponent } from './issue-detail/issue-detail.component';
import { calendarDay } from './issue-helpers';
import { NewIssueModalComponent, type IssueCreated } from './new-issue-modal/new-issue-modal.component';

type StatusFilter = '' | 'abiertas' | 'enCurso' | 'info' | 'resueltas' | 'retiradas' | 'tramite';
interface Filters {
  estado: StatusFilter;
}

const NO_FILTERS: Filters = { estado: '' };
const OPEN: OwnerIssueStatus[] = ['Abierta', 'PendienteInformacion'];
const IN_PROGRESS: OwnerIssueStatus[] = ['EnReparacion', 'PendienteProveedor'];

export const STATUS_FILTERS: { value: Exclude<StatusFilter, ''>; label: string; statuses: OwnerIssueStatus[] }[] = [
  { value: 'abiertas', label: 'Abiertas', statuses: OPEN },
  { value: 'enCurso', label: 'En curso', statuses: IN_PROGRESS },
  { value: 'info', label: 'Pendiente de información', statuses: ['PendienteInformacion'] },
  { value: 'resueltas', label: 'Resueltas', statuses: ['Resuelta', 'Cerrada'] },
  { value: 'retiradas', label: 'Retiradas', statuses: ['Retirada'] },
  { value: 'tramite', label: 'En trámite', statuses: [...OPEN, ...IN_PROGRESS] },
];

interface Kpi {
  id: 'open' | 'inProgress' | 'resolved';
  label: string;
  sub: string;
  icon: string;
  tone: KpiIconTone;
  filters: Filters;
}

const KPIS: Kpi[] = [
  { id: 'open', label: 'Abiertas', sub: 'Requieren atención', icon: 'exclamation', tone: 'error', filters: { ...NO_FILTERS, estado: 'abiertas' } },
  { id: 'inProgress', label: 'En curso', sub: '', icon: 'clock', tone: 'blue', filters: { ...NO_FILTERS, estado: 'enCurso' } },
  { id: 'resolved', label: 'Resueltas', sub: 'Últimos 6 meses', icon: 'check', tone: 'success', filters: { ...NO_FILTERS, estado: 'resueltas' } },
];

const SEARCH_DELAY_MS = 300;

/**
 * «Incidencias» del propietario (rol C): indicadores, un listado con búsqueda y filtros de las incidencias
 * de su(s) comunidad(es), el detalle de la elegida (enlace `?issue=<id>`) y el alta de nuevas. Una incidencia es de la
 * COMUNIDAD: la propiedad elegida en la cabecera solo dice en qué comunidad se está (`?estateId=` la elige por la finca);
 * en «Todas» se ven todas las comunidades y la que se crea se elige en el alta.
 */
@Component({
  selector: 'app-incidencias-c',
  standalone: true,
  imports: [TopbarComponent, CommunityScopeSelectorComponent, KpiTileComponent, IconComponent, StatusPillComponent, EmptyStateComponent, IssueDetailComponent, NewIssueModalComponent, SelectDropdownDirective],
  templateUrl: './incidencias-c.component.html',
  styleUrl: './incidencias-c.component.scss',
})
export class IncidenciasCComponent {
  readonly scope = inject(OwnerScopeService);
  private state = inject(StateService);
  private api = inject(OwnerIssuesService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private filtersBox = viewChild<ElementRef<HTMLElement>>('filtersBox');

  readonly kpis = KPIS;
  readonly statusFilters = STATUS_FILTERS;
  readonly statusInfo = OWNER_ISSUE_STATUS;
  readonly typeLabel = (type: OwnerIssueListItem['type']): string => OWNER_ISSUE_SUBTYPES.find((t) => t.value === type)?.label ?? type;
  readonly calendarDay = calendarDay;

  readonly list = signal<OwnerIssueList | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly searchText = signal('');
  private readonly query = signal('');
  readonly filters = signal<Filters>(NO_FILTERS);
  readonly filtersOpen = signal(false);
  readonly sortAsc = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly notice = signal<string | null>(null);
  readonly userId = computed(() => this.auth.currentUser()?.id ?? null);

  readonly activeFilters = computed(() => {
    const f = this.filters();
    return [f.estado].filter(Boolean).length;
  });

  readonly rows = computed<OwnerIssueListItem[]>(() => {
    const items = this.list()?.items ?? [];
    const dir = this.sortAsc() ? 1 : -1;
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => dir * (a.item.date.localeCompare(b.item.date) || b.index - a.index))
      .map((x) => x.item);
  });

  readonly scopeName = computed(() => (this.scope.isAll() ? 'Todas mis comunidades' : this.scope.selected()?.estateName ?? 'Sin comunidad vinculada'));
  /** La comunidad en la que se está; null en «Todas» (o con una propiedad aún sin comunidad). */
  readonly estateId = computed(() => (this.scope.isAll() ? null : this.scope.selected()?.estateId ?? null));
  /** Las comunidades en las que se puede avisar (el alta pregunta cuál cuando no hay una fija). */
  readonly communities = computed(() =>
    this.scope.groups().flatMap((g) => (g.estateId ? [{ id: g.estateId, name: g.estateName }] : [])),
  );

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private listSeq = 0;

  constructor() {
    // Same as «Mi comunidad»: load the owner's properties (again whenever one is added or removed); `?estateId=`
    // (from «Mi comunidad» or a property) chooses that community, i.e. its first property.
    bindOwnerScopeToRoute(['estateId'], (params) => {
      this.selectedId.set(params.get('issue'));
      // `?new=1` (quick actions and old links) opens the creation modal once; the param is dropped right away.
      if (params.get('new') === '1') {
        this.openCreate();
        void this.router.navigate([], { relativeTo: this.route, queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
    });
    // The list follows the scope, the search and the filters.
    effect(() => {
      const ready = this.scope.loaded() && this.scope.items().length > 0;
      this.scope.isAll();
      this.scope.selected();
      this.query();
      this.filters();
      untracked(() => {
        if (ready) void this.reload();
      });
    });
  }

  async reload(): Promise<void> {
    const seq = ++this.listSeq;
    const f = this.filters();
    const estateId = this.estateId() ?? undefined;
    this.loading.set(true);
    try {
      const list = await this.api.list({
        estateId,
        q: this.query() || undefined,
        status: f.estado ? STATUS_FILTERS.find((s) => s.value === f.estado)?.statuses : undefined,
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

  kpiValue(id: Kpi['id']): string | number {
    return this.list()?.kpis[id] ?? '—';
  }

  applyKpi(kpi: Kpi): void {
    this.filters.set(kpi.filters);
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

  toggleSort(): void {
    this.sortAsc.update((asc) => !asc);
  }

  openIssue(id: string): void {
    this.selectedId.set(id);
    this.syncQuery(id);
  }

  closeIssue(): void {
    this.selectedId.set(null);
    this.syncQuery(null);
  }

  openCreate(): void {
    this.notice.set(null);
    this.creating.set(true);
  }

  onCreated(result: IssueCreated): void {
    this.creating.set(false);
    const failed = result.failedUploads.map((name) => `«${name}»`).join(', ');
    this.notice.set(failed ? `Se ha creado, pero no se pudo subir ${failed}. Puedes añadirlo desde el detalle.` : null);
    void this.reload();
    this.openIssue(result.id);
  }

  onAffected(issueId: string): void {
    this.creating.set(false);
    void this.reload();
    this.openIssue(issueId);
  }

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }

  statusTone(status: OwnerIssueStatus) {
    return OWNER_ISSUE_STATUS[status]?.tone ?? 'neutral';
  }

  statusLabel(status: OwnerIssueStatus): string {
    return OWNER_ISSUE_STATUS[status]?.label ?? status;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.filtersOpen()) return;
    const box = this.filtersBox()?.nativeElement;
    if (!box || !(event.target instanceof Node) || box.contains(event.target)) return;
    // La lista del <select> de Domora cuelga del <body>, no del popover: elegir en ella no es un clic fuera.
    if (event.target instanceof Element && event.target.closest('app-select-panel')) return;
    this.filtersOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.filtersOpen()) this.filtersOpen.set(false);
  }

  private syncQuery(issueId: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { issue: issueId }, queryParamsHandling: 'merge' });
  }
}
