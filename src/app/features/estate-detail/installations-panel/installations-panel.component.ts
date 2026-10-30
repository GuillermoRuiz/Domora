import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { InspectionsService } from '../../../core/inspections.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { installationTypeFor, INSTALLATION_TYPES } from '../../../core/installation-types';
import {
  INSTALLATION_STATUS, OPERATIONAL_STATUS_OPTIONS, reviewDeadlineLabel,
  type AssetOperationalStatus, type EstateInstallations, type Installation, type InstallationDisplayStatus,
} from '../../../core/installations.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { KpiTileComponent } from '../../../shared/components/kpi-tile/kpi-tile.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { InstallationReviewsPanelsComponent } from '../installation-reviews-panels/installation-reviews-panels.component';
import { InstallationDetailModalComponent } from '../installation-detail-modal/installation-detail-modal.component';
import { InstallationFormModalComponent, type SupplierOption } from '../installation-form-modal/installation-form-modal.component';

/** Una revisión "próxima" cae en los siguientes 30 días (el mismo umbral que usa el backend). */
const SOON_DAYS = 30;
const MENU_WIDTH = 210;

export type StatusFilter = 'all' | InstallationDisplayStatus;
export type ReviewFilter = 'all' | 'soon' | 'quarter' | 'overdue';
export type SortField = 'name' | 'location' | 'status' | 'last' | 'next' | 'supplier' | 'issues';
export type SortDirection = 'asc' | 'desc';
export type SortKey = `${SortField}-${SortDirection}`;

/** Sentido con el que empieza cada columna al pulsar su cabecera por primera vez. */
const DEFAULT_DIRECTION: Record<SortField, SortDirection> = { name: 'asc', location: 'asc', status: 'asc', last: 'desc', next: 'asc', supplier: 'asc', issues: 'desc' };
const FIELD_LABEL: Record<SortField, string> = {
  name: 'Instalación', location: 'Ubicación', status: 'Estado', last: 'Última revisión', next: 'Próxima revisión', supplier: 'Proveedor', issues: 'Incidencias',
};
/** Más urgente primero: lo que pide atención sube en el orden por estado. */
const STATUS_RANK: Record<InstallationDisplayStatus, number> = {
  revision_vencida: 0, revision_proxima: 1, en_mantenimiento: 2, fuera_de_servicio: 3, operativa: 4,
};

const REVIEW_DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const reviewDate = (iso: string | null): string => (iso ? REVIEW_DATE.format(new Date(`${iso}T00:00:00Z`)) : '—');

const normalize = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Panel de Instalaciones de la finca (gestión): cifras de cabecera y, en las
 * siguientes tareas, filtros, tabla y calendario de revisiones. Carga los
 * datos una vez y los reparte a sus partes.
 */
@Component({
  selector: 'app-installations-panel',
  standalone: true,
  imports: [SelectDropdownDirective, FormsModule, IconComponent, KpiTileComponent, StatusPillComponent, InstallationDetailModalComponent, InstallationFormModalComponent, InstallationReviewsPanelsComponent],
  templateUrl: './installations-panel.component.html',
  styleUrl: './installations-panel.component.scss',
})
export class InstallationsPanelComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private inspections = inject(InspectionsService);
  private suppliersApi = inject(SuppliersStaffService);

  readonly data = signal<EstateInstallations | null>(null);
  readonly failed = signal(false);

  readonly installations = computed(() => this.data()?.items ?? []);

  readonly kpis = computed(() => {
    const items = this.installations();
    const soon = items.filter(i => i.nextReviewDaysLeft !== null && i.nextReviewDaysLeft >= 0 && i.nextReviewDaysLeft <= SOON_DAYS);
    const overdue = items.filter(i => i.nextReviewDaysLeft !== null && i.nextReviewDaysLeft < 0);
    return {
      total: items.length,
      maintenance: items.filter(i => i.operationalStatus === 'en_mantenimiento').length,
      soon: soon.length,
      overdue: overdue.length,
      issues: items.reduce((sum, i) => sum + i.openIssues, 0),
    };
  });

  /** "en los próximos 30 días", más las vencidas si las hay. */
  readonly soonSub = computed(() => {
    const { overdue } = this.kpis();
    return overdue > 0 ? `próximos 30 días · ${overdue} ${overdue === 1 ? 'vencida' : 'vencidas'}` : 'en los próximos 30 días';
  });

  // ── Filtros y orden ─────────────────────────────────────────────────
  readonly search = signal('');
  readonly typeFilter = signal<string>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly reviewFilter = signal<ReviewFilter>('all');
  /** 'all' | 'none' (sin proveedor) | id de proveedor. */
  readonly supplierFilter = signal<string>('all');
  /** Solo las que tienen incidencias abiertas (lo activa la ficha de incidencias). */
  readonly issuesOnly = signal(false);
  readonly sortKey = signal<SortKey>('name-asc');

  readonly statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    ...(Object.entries(INSTALLATION_STATUS) as [InstallationDisplayStatus, { text: string }][]).map(([value, { text }]) => ({ value, label: text })),
  ];
  readonly reviewOptions: { value: ReviewFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'soon', label: 'En 30 días' },
    { value: 'quarter', label: 'En 90 días' },
    { value: 'overdue', label: 'Vencidas' },
  ];
  private readonly baseSortOptions: { value: SortKey; label: string }[] = [
    { value: 'name-asc', label: 'Nombre (A-Z)' },
    { value: 'name-desc', label: 'Nombre (Z-A)' },
    { value: 'next-asc', label: 'Próxima revisión' },
    { value: 'last-desc', label: 'Última revisión' },
    { value: 'issues-desc', label: 'Más incidencias' },
  ];
  /** Las del desplegable, más la que haya elegido una cabecera de columna (para que se vea qué orden hay). */
  readonly sortOptions = computed(() => {
    const key = this.sortKey();
    if (this.baseSortOptions.some(o => o.value === key)) return this.baseSortOptions;
    return [...this.baseSortOptions, { value: key, label: `${FIELD_LABEL[this.sortField()]} ${this.sortDirection() === 'asc' ? '↑' : '↓'}` }];
  });
  readonly sortField = computed(() => this.sortKey().split('-')[0] as SortField);
  readonly sortDirection = computed(() => this.sortKey().split('-')[1] as SortDirection);

  /** Solo los tipos que hay en la finca (un desplegable con opciones vacías no sirve). */
  readonly typeOptions = computed(() => {
    const present = new Set(this.installations().map(i => installationTypeFor(i.category).key));
    return [{ key: 'all', label: 'Todos' }, ...INSTALLATION_TYPES.filter(t => present.has(t.key)).map(({ key, label }) => ({ key, label }))];
  });
  readonly supplierOptions = computed(() => {
    const suppliers = new Map<string, string>();
    for (const i of this.installations()) if (i.supplier) suppliers.set(i.supplier.id, i.supplier.name);
    const named = [...suppliers].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([id, name]) => ({ id, name }));
    return [{ id: 'all', name: 'Todos' }, ...named, ...(this.installations().some(i => !i.supplier) ? [{ id: 'none', name: 'Sin proveedor' }] : [])];
  });

  readonly hasFilters = computed(() =>
    this.search().trim() !== '' || this.typeFilter() !== 'all' || this.statusFilter() !== 'all'
    || this.reviewFilter() !== 'all' || this.supplierFilter() !== 'all' || this.issuesOnly());

  readonly visible = computed(() => {
    const term = normalize(this.search().trim());
    const type = this.typeFilter();
    const status = this.statusFilter();
    const review = this.reviewFilter();
    const supplier = this.supplierFilter();
    const filtered = this.installations().filter(i => {
      if (type !== 'all' && installationTypeFor(i.category).key !== type) return false;
      if (status !== 'all' && i.displayStatus !== status) return false;
      if (review !== 'all' && !this.matchesReview(i, review)) return false;
      if (supplier === 'none' ? i.supplier !== null : supplier !== 'all' && i.supplier?.id !== supplier) return false;
      if (this.issuesOnly() && i.openIssues === 0) return false;
      if (!term) return true;
      return [i.name, i.location, i.category, installationTypeFor(i.category).label, i.supplier?.name, i.manufacturer]
        .some(value => normalize(value ?? '').includes(term));
    });
    return this.sorted(filtered);
  });

  private matchesReview(i: Installation, review: Exclude<ReviewFilter, 'all'>): boolean {
    const days = i.nextReviewDaysLeft;
    if (days === null) return false;
    if (review === 'overdue') return days < 0;
    return days >= 0 && days <= (review === 'soon' ? SOON_DAYS : 90);
  }

  private sorted(list: Installation[]): Installation[] {
    const byName = (a: Installation, b: Installation) => a.name.localeCompare(b.name, 'es', { numeric: true });
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    // Sin dato (fecha, ubicación, proveedor) va siempre al final, sea cual sea el sentido del orden.
    const nullable = <T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number =>
      a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : sign * compare(a, b);
    const text = (x: string, y: string) => x.localeCompare(y, 'es', { numeric: true });
    const compare = (a: Installation, b: Installation): number => {
      switch (this.sortField()) {
        case 'location': return nullable(a.location, b.location, text);
        case 'supplier': return nullable(a.supplier?.name ?? null, b.supplier?.name ?? null, text);
        case 'last': return nullable(a.lastReviewDate, b.lastReviewDate, text);
        case 'next': return nullable(a.nextReviewDate, b.nextReviewDate, text);
        case 'status': return sign * (STATUS_RANK[a.displayStatus] - STATUS_RANK[b.displayStatus]);
        case 'issues': return sign * (a.openIssues - b.openIssues);
        default: return sign * byName(a, b);
      }
    };
    return [...list].sort((a, b) => compare(a, b) || byName(a, b));
  }

  /** Clic en la cabecera de una columna: la ordena; otro clic invierte el sentido. */
  toggleSort(field: SortField): void {
    const direction: SortDirection = this.sortField() === field
      ? (this.sortDirection() === 'asc' ? 'desc' : 'asc')
      : DEFAULT_DIRECTION[field];
    this.sortKey.set(`${field}-${direction}`);
  }
  ariaSort(field: SortField): 'ascending' | 'descending' | 'none' {
    if (this.sortField() !== field) return 'none';
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  clearFilters(): void {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
    this.reviewFilter.set('all');
    this.supplierFilter.set('all');
    this.issuesOnly.set(false);
  }

  /** Clic en una ficha: deja solo lo que cuenta (otro clic en la misma lo quita). */
  showAll(): void {
    this.clearFilters();
  }
  toggleMaintenance(): void {
    this.statusFilter.set(this.statusFilter() === 'en_mantenimiento' ? 'all' : 'en_mantenimiento');
  }
  toggleSoon(): void {
    this.reviewFilter.set(this.reviewFilter() === 'soon' ? 'all' : 'soon');
  }
  toggleIssues(): void {
    this.issuesOnly.set(!this.issuesOnly());
  }

  // ── Tabla ───────────────────────────────────────────────────────────
  readonly statusChoices = OPERATIONAL_STATUS_OPTIONS;
  readonly columns: { field: SortField; label: string }[] = (['name', 'location', 'status', 'last', 'next', 'supplier', 'issues'] as SortField[])
    .map(field => ({ field, label: FIELD_LABEL[field] }));

  typeInfo(i: Installation) {
    return installationTypeFor(i.category);
  }
  pill(i: Installation) {
    const { text, tone } = INSTALLATION_STATUS[i.displayStatus];
    return { text, tone };
  }
  dateLabel(iso: string | null): string {
    return reviewDate(iso);
  }
  /** "en 9 meses" / "hace 20 días"; vacío si no hay próxima revisión. */
  deadline(i: Installation): string {
    return reviewDeadlineLabel(i.nextReviewDaysLeft);
  }
  /** Color de la próxima revisión: avisa cuando ya pasó o está al caer. */
  nextTone(i: Installation): 'danger' | 'warning' | null {
    if (i.nextReviewDaysLeft === null) return null;
    if (i.nextReviewDaysLeft < 0) return 'danger';
    return i.nextReviewDaysLeft <= SOON_DAYS ? 'warning' : null;
  }

  // ── Menú de acción de cada fila ─────────────────────────────────────
  // `position: fixed` con coordenadas de la ventana: la tabla está en un
  // contenedor con scroll y un menú absoluto se recortaría.
  readonly menuId = signal<string | null>(null);
  readonly menuPosition = signal({ top: 0, left: 0 });
  readonly actionError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly menuInstallation = computed(() => this.installations().find(i => i.id === this.menuId()) ?? null);
  /** Ir a Inspecciones para registrar una revisión. */
  @Output() openInspections = new EventEmitter<void>();
  /** "Ver calendario": ir a Tareas. */
  @Output() openCalendar = new EventEmitter<void>();
  /** Pulsar las incidencias de una instalación: ir a Incidencias filtradas por ella. */
  @Output() openIssues = new EventEmitter<{ id: string; name: string }>();

  readonly upcoming = computed(() => this.data()?.upcoming ?? []);

  /** Pulsar una revisión pendiente: abre la ficha de su instalación. */
  openAsset(assetId: string): void {
    const installation = this.installations().find(i => i.id === assetId);
    if (installation) this.openDetail(installation);
  }

  toggleMenu(event: Event, id: string): void {
    event.stopPropagation();
    if (this.menuId() === id) {
      this.closeMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPosition.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) });
    this.menuId.set(id);
  }
  closeMenu(): void {
    this.menuId.set(null);
  }

  async setStatus(installation: Installation, status: AssetOperationalStatus): Promise<void> {
    this.closeMenu();
    if (installation.operationalStatus === status) return;
    this.saving.set(true);
    this.actionError.set(null);
    try {
      await this.inspections.updateAsset(this.estateId, installation.id, { operationalStatus: status });
      await this.reload();
    } catch (error) {
      console.error('Error cambiando el estado de la instalación', error);
      this.actionError.set(`No se pudo cambiar el estado de "${installation.name}". Inténtalo de nuevo.`);
    } finally {
      this.saving.set(false);
    }
  }

  registerReview(): void {
    this.closeMenu();
    this.openInspections.emit();
  }

  // ── Ficha y alta/edición ────────────────────────────────────────────
  /** Instalación cuya ficha está abierta. */
  readonly detail = signal<Installation | null>(null);
  readonly formOpen = signal(false);
  /** null = alta nueva. */
  readonly formTarget = signal<Installation | null>(null);
  readonly supplierOptions4Form = signal<SupplierOption[]>([]);

  openDetail(installation: Installation): void {
    this.closeMenu();
    this.detail.set(installation);
  }

  async openForm(installation: Installation | null): Promise<void> {
    this.closeMenu();
    this.detail.set(null);
    this.formTarget.set(installation);
    await this.loadSuppliers(installation);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.formTarget.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeForm();
    await this.reload();
  }

  /** Proveedores activos de la finca (más el actual de la instalación aunque esté de baja). */
  private async loadSuppliers(current: Installation | null): Promise<void> {
    try {
      const all = await this.suppliersApi.listSuppliers(this.estateId);
      const options = all.filter(s => s.status === 'Activo' || s.id === current?.supplier?.id).map(s => ({ id: s.id, name: s.name }));
      this.supplierOptions4Form.set(options.sort((a, b) => a.name.localeCompare(b.name, 'es')));
    } catch (error) {
      console.error('Error cargando los proveedores de la finca', error);
      // Sin lista no se puede elegir proveedor, pero sí crear o editar lo demás (el actual se conserva).
      this.supplierOptions4Form.set(current?.supplier ? [{ id: current.supplier.id, name: current.supplier.name }] : []);
    }
  }

  ngOnInit(): Promise<void> {
    return this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.data.set(await this.inspections.listInstallations(this.estateId));
      this.failed.set(false);
    } catch (error) {
      console.error('Error cargando las instalaciones de la finca', error);
      // Si ya había datos, se conservan: solo falló la recarga tras un cambio.
      if (this.data() === null) this.failed.set(true);
    }
  }
}
