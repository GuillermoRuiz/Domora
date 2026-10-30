import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { supplierCategoryFor, SUPPLIER_CATEGORIES } from '../../../core/supplier-categories';
import {
  contractDeadlineLabel, SUPPLIER_STATUS, visitDate, visitTime,
  type SupplierDisplayStatus, type SupplierPanelOverview, type SupplierPanelRow,
} from '../../../core/supplier-panel.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { KpiTileComponent } from '../../../shared/components/kpi-tile/kpi-tile.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { SupplierFormModalComponent } from './supplier-form-modal/supplier-form-modal.component';
import { SupplierInterventionsComponent } from './supplier-interventions/supplier-interventions.component';
import { SupplierVisitsModalComponent } from './supplier-visits-modal/supplier-visits-modal.component';
import { SupplierQuickContactComponent } from './supplier-quick-contact/supplier-quick-contact.component';

export type StatusFilter = 'all' | SupplierDisplayStatus;
/** Lo que filtran las fichas de contratos: los vigentes (incluye por vencer) o solo los que hay que renovar. */
export type ContractFilter = 'all' | 'live' | 'expiring';
export type SortField = 'name' | 'contact' | 'visit' | 'contract' | 'status' | 'issues';
export type SortDirection = 'asc' | 'desc';
export type SortKey = `${SortField}-${SortDirection}`;

/** Sentido con el que empieza cada columna al pulsar su cabecera por primera vez. */
const DEFAULT_DIRECTION: Record<SortField, SortDirection> = { name: 'asc', contact: 'asc', visit: 'asc', contract: 'asc', status: 'asc', issues: 'desc' };
const FIELD_LABEL: Record<SortField, string> = {
  name: 'Proveedor', contact: 'Persona de contacto', visit: 'Próxima visita', contract: 'Contrato', status: 'Estado', issues: 'Incidencias',
};
/** Más urgente primero: lo que pide atención sube en el orden por estado. */
const STATUS_RANK: Record<SupplierDisplayStatus, number> = { vencido: 0, renovar: 1, activo: 2, baja: 3 };

const MENU_WIDTH = 190;

const normalize = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Panel de Proveedores de la finca (gestión): cifras de cabecera, filtros y
 * tabla con persona de contacto, próxima visita y contrato. Carga el resumen
 * una vez y lo reparte a sus partes.
 */
@Component({
  selector: 'app-suppliers-panel',
  standalone: true,
  imports: [SelectDropdownDirective, FormsModule, IconComponent, KpiTileComponent, StatusPillComponent, SupplierQuickContactComponent, SupplierInterventionsComponent, SupplierFormModalComponent, SupplierVisitsModalComponent],
  templateUrl: './suppliers-panel.component.html',
  styleUrl: './suppliers-panel.component.scss',
})
export class SuppliersPanelComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private api = inject(SuppliersStaffService);

  readonly data = signal<SupplierPanelOverview | null>(null);
  readonly failed = signal(false);

  readonly suppliers = computed(() => this.data()?.items ?? []);
  readonly kpis = computed(() => this.data()?.kpis ?? { totalSuppliers: 0, activeContracts: 0, expiringContracts: 0, openIssues: 0 });

  // ── Filtros y orden ─────────────────────────────────────────────────
  readonly search = signal('');
  readonly categoryFilter = signal<string>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly contractFilter = signal<ContractFilter>('all');
  /** Solo los que tienen incidencias abiertas (lo activa su ficha). */
  readonly issuesOnly = signal(false);
  readonly sortKey = signal<SortKey>('name-asc');

  readonly statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    ...(Object.entries(SUPPLIER_STATUS) as [SupplierDisplayStatus, { text: string }][]).map(([value, { text }]) => ({ value, label: text })),
  ];
  private readonly baseSortOptions: { value: SortKey; label: string }[] = [
    { value: 'name-asc', label: 'Nombre (A-Z)' },
    { value: 'name-desc', label: 'Nombre (Z-A)' },
    { value: 'visit-asc', label: 'Próxima visita' },
    { value: 'contract-asc', label: 'Contrato que vence antes' },
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

  /** Solo las categorías que hay en la finca (un desplegable con opciones vacías no sirve). */
  readonly categoryOptions = computed(() => {
    const present = new Set(this.suppliers().map(s => supplierCategoryFor(s.category).key));
    return [{ key: 'all', label: 'Todas' }, ...SUPPLIER_CATEGORIES.filter(c => present.has(c.key)).map(({ key, label }) => ({ key, label }))];
  });

  readonly hasFilters = computed(() =>
    this.search().trim() !== '' || this.categoryFilter() !== 'all' || this.statusFilter() !== 'all'
    || this.contractFilter() !== 'all' || this.issuesOnly());

  readonly visible = computed(() => {
    const term = normalize(this.search().trim());
    const category = this.categoryFilter();
    const status = this.statusFilter();
    const contract = this.contractFilter();
    const filtered = this.suppliers().filter(s => {
      if (category !== 'all' && supplierCategoryFor(s.category).key !== category) return false;
      if (status !== 'all' && s.displayStatus !== status) return false;
      if (contract === 'live' && !(s.contract?.status === 'Activo' || s.contract?.status === 'PorVencer')) return false;
      if (contract === 'expiring' && s.contract?.status !== 'PorVencer') return false;
      if (this.issuesOnly() && s.openIssues === 0) return false;
      if (!term) return true;
      return [s.name, s.category, supplierCategoryFor(s.category).label, s.contactName, s.phone, s.email]
        .some(value => normalize(value ?? '').includes(term));
    });
    return this.sorted(filtered);
  });

  private sorted(list: SupplierPanelRow[]): SupplierPanelRow[] {
    const byName = (a: SupplierPanelRow, b: SupplierPanelRow) => a.name.localeCompare(b.name, 'es', { numeric: true });
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    // Sin dato (contacto, visita, contrato) va siempre al final, sea cual sea el sentido del orden.
    const nullable = <T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number =>
      a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : sign * compare(a, b);
    const text = (x: string, y: string) => x.localeCompare(y, 'es', { numeric: true });
    const compare = (a: SupplierPanelRow, b: SupplierPanelRow): number => {
      switch (this.sortField()) {
        case 'contact': return nullable(a.contactName, b.contactName, text);
        case 'visit': return nullable(a.nextVisit?.scheduledAt ?? null, b.nextVisit?.scheduledAt ?? null, text);
        case 'contract': return nullable(a.contract?.daysLeft ?? null, b.contract?.daysLeft ?? null, (x, y) => x - y);
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
    this.categoryFilter.set('all');
    this.statusFilter.set('all');
    this.contractFilter.set('all');
    this.issuesOnly.set(false);
  }

  /** Clic en una ficha: deja solo lo que cuenta (otro clic en la misma lo quita). */
  showAll(): void {
    this.clearFilters();
  }
  toggleLiveContracts(): void {
    this.contractFilter.set(this.contractFilter() === 'live' ? 'all' : 'live');
  }
  toggleExpiring(): void {
    this.contractFilter.set(this.contractFilter() === 'expiring' ? 'all' : 'expiring');
  }
  toggleIssues(): void {
    this.issuesOnly.set(!this.issuesOnly());
  }

  // ── Tabla ───────────────────────────────────────────────────────────
  readonly columns: { field: SortField; label: string }[] = (['name', 'contact', 'visit', 'contract', 'status', 'issues'] as SortField[])
    .map(field => ({ field, label: FIELD_LABEL[field] }));

  /** Proveedor sobre el que se muestra «Contacto rápido»: el pulsado o, si no hay, el primero de la lista. */
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed<SupplierPanelRow | null>(() => {
    const rows = this.visible();
    return rows.find(s => s.id === this.selectedId()) ?? rows[0] ?? null;
  });
  select(id: string): void {
    this.selectedId.set(id);
  }

  readonly interventions = computed(() => this.data()?.recentInterventions ?? []);

  /** Pulsar una intervención: selecciona a su proveedor; si los filtros lo ocultan, los quita para que se vea. */
  focusSupplier(id: string): void {
    if (!this.visible().some(s => s.id === id)) this.clearFilters();
    this.select(id);
  }

  categoryInfo(s: SupplierPanelRow) {
    return supplierCategoryFor(s.category);
  }
  pill(s: SupplierPanelRow) {
    const { text, tone } = SUPPLIER_STATUS[s.displayStatus];
    return { text, tone };
  }
  contractLabel(s: SupplierPanelRow): string {
    return contractDeadlineLabel(s.contract);
  }
  /** Color del contrato: avisa cuando está por vencer o ya venció. */
  contractTone(s: SupplierPanelRow): 'danger' | 'warning' | null {
    if (s.contract?.status === 'Vencido') return 'danger';
    return s.contract?.status === 'PorVencer' ? 'warning' : null;
  }
  dateLabel(iso: string | null): string {
    return visitDate(iso);
  }
  timeLabel(iso: string): string {
    return visitTime(iso);
  }

  // ── Menú de acción de cada fila ─────────────────────────────────────
  // `position: fixed` con coordenadas de la ventana: la tabla está en un
  // contenedor con scroll y un menú absoluto se recortaría.
  readonly menuId = signal<string | null>(null);
  readonly menuPosition = signal({ top: 0, left: 0 });
  readonly actionError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly menuSupplier = computed(() => this.suppliers().find(s => s.id === this.menuId()) ?? null);

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

  /** Baja lógica (nunca se borra: hay facturas e incidencias ligadas) y vuelta a activo. */
  async toggleActive(supplier: SupplierPanelRow): Promise<void> {
    this.closeMenu();
    const status = supplier.status === 'Activo' ? 'Baja' : 'Activo';
    this.saving.set(true);
    this.actionError.set(null);
    try {
      await this.api.updateSupplier(this.estateId, supplier.id, { status });
      await this.reload();
    } catch (error) {
      console.error('Error cambiando el estado del proveedor', error);
      this.actionError.set(`No se pudo ${status === 'Baja' ? 'dar de baja' : 'reactivar'} a "${supplier.name}". Inténtalo de nuevo.`);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Visitas ─────────────────────────────────────────────────────────
  /** Proveedor cuyo modal de visitas está abierto. */
  readonly visitsTarget = signal<SupplierPanelRow | null>(null);
  readonly visitsStartWithForm = signal(false);

  openVisits(supplier: SupplierPanelRow, scheduleNew: boolean): void {
    this.closeMenu();
    this.visitsStartWithForm.set(scheduleNew);
    this.visitsTarget.set(supplier);
  }
  closeVisits(): void {
    this.visitsTarget.set(null);
  }

  // ── Alta y edición ──────────────────────────────────────────────────
  readonly formOpen = signal(false);
  /** null = alta nueva. */
  readonly formTarget = signal<SupplierPanelRow | null>(null);

  openForm(supplier: SupplierPanelRow | null): void {
    this.closeMenu();
    this.formTarget.set(supplier);
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

  ngOnInit(): Promise<void> {
    return this.reload();
  }

  async reload(): Promise<void> {
    try {
      this.data.set(await this.api.getSuppliersOverview(this.estateId));
      this.failed.set(false);
    } catch (error) {
      console.error('Error cargando los proveedores de la finca', error);
      // Si ya había datos, se conservan: solo falló la recarga tras un cambio.
      if (this.data() === null) this.failed.set(true);
    }
  }
}
