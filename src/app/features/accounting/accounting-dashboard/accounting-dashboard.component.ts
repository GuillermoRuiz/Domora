import { Component, OnInit, inject, signal, computed, HostListener, ElementRef, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TopbarComponent } from '../../../layout/topbar/topbar.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { AccountingEstate, Debtor, EstateType } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { DebtorsService } from '../../../core/debtors.service';
import { ReceiptsService } from '../../../core/receipts.service';
import { AccountingCommunitySelectorComponent } from '../accounting-community-selector/accounting-community-selector.component';
import { AccountingOverviewViewsComponent, AccountingSortColumn } from '../accounting-overview-views/accounting-overview-views.component';
import { accountingCsv } from '../accounting-export';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
type DelinquencyFilter = 'Todos' | 'Al corriente' | 'Con morosidad';
type SortColumn = AccountingSortColumn;
type SortDirection = 'asc' | 'desc';

const ESTATE_TYPE_FILTERS: EstateType[] = ['Edificio', 'Urbanización', 'Garaje', 'Trasteros', 'Local'];

@Component({
  selector: 'app-accounting-dashboard',
  standalone: true,
  imports: [TopbarComponent, AccountingCommunitySelectorComponent, AccountingOverviewViewsComponent, IconComponent, BtnComponent, BadgeComponent, CurrencyPipe, FormsModule, SelectDropdownDirective],
  templateUrl: './accounting-dashboard.component.html',
  styleUrl: './accounting-dashboard.component.scss'
})
export class AccountingDashboardComponent implements OnInit {
  router = inject(Router);
  data = inject(AccountingService);
  debtorsSvc = inject(DebtorsService);
  receipts = inject(ReceiptsService);
  estates = signal<AccountingEstate[]>([]);
  debtors = signal<Debtor[]>([]);
  loaded = signal(false);
  loadError = signal(false);
  view = signal<'table' | 'cards'>(this.savedView());
  showFilters = signal(false);
  private readonly filterControl = viewChild<ElementRef<HTMLElement>>('filterControl');
  private readonly filterTrigger = viewChild<ElementRef<HTMLButtonElement>>('filterTrigger');

  // ── Búsqueda / filtros de la tabla "Fincas" ──────────────────────────
  estateTypeFilters = ESTATE_TYPE_FILTERS;
  searchName = signal('');
  filterType = signal<EstateType | 'Todos'>('Todos');
  filterDelinquency = signal<DelinquencyFilter>('Todos');

  // ── Orden de la tabla ─────────────────────────────────────────────────
  sortColumn = signal<SortColumn>('name');
  sortDirection = signal<SortDirection>('asc');

  filteredEstates = computed(() => {
    const q = this.normalize(this.searchName());
    const type = this.filterType();
    const delinquency = this.filterDelinquency();
    let list = this.estates();
    if (q) list = list.filter(e => this.normalize(`${e.name} ${e.address ?? ''} ${e.streetNumber ?? ''} ${e.location ?? ''}`).includes(q));
    if (type !== 'Todos') list = list.filter(e => e.type === type);
    if (delinquency === 'Al corriente') list = list.filter(e => e.delinquency <= 0);
    if (delinquency === 'Con morosidad') list = list.filter(e => e.delinquency > 0);
    return list;
  });

  sortedEstates = computed(() => {
    const col = this.sortColumn();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    const list = [...this.filteredEstates()];
    list.sort((a, b) => {
      if (col === 'name') return a.name.localeCompare(b.name) * dir;
      return (this.sortValue(a, col) - this.sortValue(b, col)) * dir;
    });
    return list;
  });

  async ngOnInit(): Promise<void> {
    this.loaded.set(false);
    this.loadError.set(false);
    try {
      const [estates, debtors] = await Promise.all([
        this.data.listAccountingEstates(),
        this.debtorsSvc.listDebtors(),
      ]);
      this.estates.set(estates);
      this.debtors.set(debtors);
    } catch (error) {
      console.error('Error cargando el panel contable', error);
      this.loadError.set(true);
    } finally {
      this.loaded.set(true);
    }
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  }

  private savedView(): 'table' | 'cards' {
    try { return localStorage.getItem('domora-accounting-view') === 'cards' ? 'cards' : 'table'; }
    catch { return 'table'; }
  }

  setView(view: 'table' | 'cards'): void {
    this.view.set(view);
    try { localStorage.setItem('domora-accounting-view', view); } catch { /* La vista funciona aunque el almacenamiento no esté disponible. */ }
  }

  clearFilters(): void {
    this.searchName.set('');
    this.filterType.set('Todos');
    this.filterDelinquency.set('Todos');
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (this.showFilters() && !this.filterControl()?.nativeElement.contains(event.target as Node)) this.showFilters.set(false);
  }

  @HostListener('document:keydown.escape')
  closeFilters(): void {
    if (!this.showFilters()) return;
    this.showFilters.set(false);
    this.filterTrigger()?.nativeElement.focus();
  }

  downloadCsv(): void {
    const url = URL.createObjectURL(new Blob([accountingCsv(this.sortedEstates())], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'contabilidad-comunidades.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  get consolidatedBalance(): number {
    return this.estates().reduce((s, e) => s + e.balance, 0);
  }
  get totalDelinquency(): number {
    return this.estates().reduce((s, e) => s + e.delinquency, 0);
  }
  private sortValue(e: AccountingEstate, col: SortColumn): number {
    switch (col) {
      case 'balance': return e.balance;
      case 'reserve': return e.reserve;
      case 'delinquency': return e.delinquency;
      default: return 0;
    }
  }

  setSort(col: SortColumn): void {
    if (this.sortColumn() === col) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(col);
      this.sortDirection.set('asc');
    }
  }

  openDetail(estate: AccountingEstate): void {
    this.router.navigate(['/b/accounting', estate.id]);
  }

  // ── Generar recibos ──────────────────────────────────────────────────
  showGenerarRecibos = signal(false);
  grEstateId = signal('');
  grPeriodKey = signal(this.currentPeriodKey());
  grSaving = signal(false);
  grError = signal<string | null>(null);
  grResult = signal<{ created: number; skipped: number; totalProperties: number } | null>(null);

  private currentPeriodKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  openGenerarRecibos(): void {
    this.grEstateId.set(this.estates().length === 1 ? this.estates()[0].id : '');
    this.grPeriodKey.set(this.currentPeriodKey());
    this.grError.set(null);
    this.grResult.set(null);
    this.showGenerarRecibos.set(true);
  }

  closeGenerarRecibos(): void {
    this.showGenerarRecibos.set(false);
  }

  async submitGenerarRecibos(): Promise<void> {
    if (!this.grEstateId() || !/^\d{4}-\d{2}$/.test(this.grPeriodKey())) {
      this.grError.set('Elige una finca y un periodo válido (AAAA-MM)');
      return;
    }
    this.grSaving.set(true);
    this.grError.set(null);
    try {
      const result = await this.receipts.generateReceipts(this.grEstateId(), this.grPeriodKey());
      this.grResult.set(result);
    } catch (error: any) {
      console.error('Error generando los recibos', error);
      const msg = error?.error?.message;
      this.grError.set(typeof msg === 'string' ? msg : 'No se pudieron generar los recibos');
    } finally {
      this.grSaving.set(false);
    }
  }
}
