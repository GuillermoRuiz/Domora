import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { ContractRenewal, EstateContract, SupplierContract } from '../../../core/models';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { ContractCancelModalComponent } from './contract-cancel-modal/contract-cancel-modal.component';
import { ContractDetailComponent } from './contract-detail/contract-detail.component';
import { ContractFormModalComponent } from './contract-form-modal/contract-form-modal.component';
import { ContractRenewModalComponent } from './contract-renew-modal/contract-renew-modal.component';
import { ContractRenewalsHistoryComponent } from './contract-renewals-history/contract-renewals-history.component';
import { ContractsPanelsComponent } from './contracts-panels/contracts-panels.component';
import { ContractsKpisComponent } from './contracts-kpis/contracts-kpis.component';
import { ContractsTableComponent } from './contracts-table/contracts-table.component';
import { ContractsToolbarComponent } from './contracts-toolbar/contracts-toolbar.component';
import {
  DEFAULT_FILTERS, activeShortcut, categoryOptions, contractKpis, filterContracts, filtersFromParams, filtersToParams, shortcutFilters,
  sortContracts, supplierOptions, type ContractFilters, type KpiShortcut,
} from './contracts-model';

/** Diálogo abierto sobre la pestaña: uno a la vez. */
type Dialog =
  | { kind: 'new' }
  | { kind: 'history' }
  | { kind: 'edit' | 'renew' | 'cancel' | 'detail'; contract: EstateContract };

/**
 * Pestaña «Contratos» de la finca (rol B): fichas con atajos de filtro, buscador y filtros (en la
 * URL), la tabla de contratos con sus avisos y la gestión de cada uno (ver, editar, renovar, cancelar y
 * dar de alta), reutilizando las reglas del módulo de proveedores.
 */
@Component({
  selector: 'app-contracts-tab',
  standalone: true,
  imports: [
    ContractsKpisComponent, ContractsToolbarComponent, ContractsTableComponent, ContractDetailComponent, ContractFormModalComponent,
    ContractRenewModalComponent, ContractCancelModalComponent, ContractsPanelsComponent, ContractRenewalsHistoryComponent,
  ],
  templateUrl: './contracts-tab.component.html',
  styleUrl: './contracts-tab.component.scss',
})
export class ContractsTabComponent implements OnInit, OnDestroy {
  @Input({ required: true }) estateId!: string;
  /** Ir a la pestaña Proveedores (dar de alta proveedores, ver el proveedor de un contrato). */
  @Output() openProviders = new EventEmitter<void>();

  private suppliers = inject(SuppliersStaffService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly contracts = signal<EstateContract[] | null>(null);
  readonly renewals = signal<ContractRenewal[]>([]);
  readonly failed = signal(false);
  readonly dialog = signal<Dialog | null>(null);
  readonly toast = signal<string | null>(null);

  /** Los filtros viven en la URL (`q`, `vig`, `prov`…): se leen al abrir y se escriben al cambiar. */
  readonly filters = signal<ContractFilters>(filtersFromParams((key) => this.route.snapshot.queryParamMap.get(key)));
  readonly supplierChoices = computed(() => supplierOptions(this.contracts() ?? []));
  readonly categoryChoices = computed(() => categoryOptions(this.contracts() ?? []));
  readonly kpis = computed(() => contractKpis(this.contracts() ?? []));
  readonly selectedShortcut = computed(() => activeShortcut(this.filters()));
  /** Contratos tras aplicar filtros y orden. */
  readonly visible = computed<EstateContract[]>(() => sortContracts(filterContracts(this.contracts() ?? [], this.filters()), this.filters().sort));
  /** El contrato del diálogo abierto, siempre con los datos más recientes de la lista. */
  readonly dialogContract = computed<EstateContract | null>(() => {
    const d = this.dialog();
    if (!d || d.kind === 'new' || d.kind === 'history') return null;
    return this.contracts()?.find((c) => c.id === d.contract.id) ?? d.contract;
  });

  /** Pulsar la ficha que ya está aplicada quita el filtro. */
  pickShortcut(kind: KpiShortcut): void {
    this.setFilters(this.selectedShortcut() === kind ? DEFAULT_FILTERS : shortcutFilters(kind));
  }

  clearFilters(): void {
    this.setFilters(DEFAULT_FILTERS);
  }

  /**
   * Aplica los filtros y, con un pequeño retardo (para no escribir en cada tecla), los refleja en la URL junto con
   * la pestaña (`tab=contracts`): así el enlace vuelve a abrir esta pestaña aunque se llegara a ella con un clic.
   */
  setFilters(next: ContractFilters): void {
    this.filters.set(next);
    if (this.urlTimer) clearTimeout(this.urlTimer);
    this.urlTimer = setTimeout(() => {
      this.urlTimer = null;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: 'contracts', ...filtersToParams(next) }, queryParamsHandling: 'merge', replaceUrl: true });
    }, 250);
  }

  // ── Diálogos y acciones ──────────────────────────────────────────────

  openNew(): void { this.dialog.set({ kind: 'new' }); }
  openHistory(): void { this.dialog.set({ kind: 'history' }); }
  openDialog(kind: 'edit' | 'renew' | 'cancel' | 'detail', contract: EstateContract): void { this.dialog.set({ kind, contract }); }
  closeDialog(): void { this.dialog.set(null); }

  /** «Ver todos» de «Próximos vencimientos»: la tabla con los vigentes, ordenada por vencimiento (D10). */
  showAllByExpiry(): void {
    this.setFilters({ ...DEFAULT_FILTERS, vigencia: 'activos', sort: 'vencimiento_asc' });
    queueMicrotask(() => this.host.nativeElement.querySelector('.contracts__card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }

  /** «Ver proveedor»: lleva a la pestaña Proveedores. */
  goToSupplier(): void {
    this.dialog.set(null);
    this.openProviders.emit();
  }

  /** Tras guardar, renovar o cancelar: se cierra el diálogo, se avisa y se recarga lo que cambió. */
  async afterChange(message: string, _saved?: SupplierContract): Promise<void> {
    this.dialog.set(null);
    this.showToast(message);
    await this.load();
  }

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3500);
  }

  // ── Carga ────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [contracts, renewals] = await Promise.all([
        this.suppliers.listEstateContracts(this.estateId),
        // El histórico es un extra: si falla, la tabla se sigue viendo.
        this.suppliers.listEstateRenewals(this.estateId).catch((error) => {
          console.error('Error cargando las renovaciones de la finca', error);
          return [] as ContractRenewal[];
        }),
      ]);
      this.contracts.set(contracts);
      this.renewals.set(renewals);
      this.failed.set(false);
    } catch (error) {
      console.error('Error cargando los contratos de la finca', error);
      if (this.contracts() === null) this.failed.set(true);
    }
  }

  ngOnDestroy(): void {
    if (this.urlTimer) clearTimeout(this.urlTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }
}
