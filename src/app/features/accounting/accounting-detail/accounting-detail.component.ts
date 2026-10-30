import { NgTemplateOutlet } from '@angular/common';
import { PageActionRegistry } from '../../../shared/components/page-action/page-action.directive';
import { AccountingAiPanelComponent } from '../../ai/accounting-ai-panel.component';
import { Component, DestroyRef, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, filter, from, map, of, startWith, switchMap } from 'rxjs';
import { CurrencyPipe } from '@angular/common';
import { TopbarComponent } from '../../../layout/topbar/topbar.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { ProgressBarComponent } from '../../../shared/components/progress-bar/progress-bar.component';
import { RecibosTabComponent } from '../recibos-tab/recibos-tab.component';
import { TesoreriaTabComponent } from '../tesoreria-tab/tesoreria-tab.component';
import { DiarioTabComponent } from '../diario-tab/diario-tab.component';
import { PresupuestoTabComponent } from '../presupuesto-tab/presupuesto-tab.component';
import { MorosidadTabComponent } from '../morosidad-tab/morosidad-tab.component';
import { RemesasTabComponent } from '../remesas-tab/remesas-tab.component';
import { CuentasContablesTabComponent } from '../cuentas-contables-tab/cuentas-contables-tab.component';
import { CentrosCosteTabComponent } from '../centros-coste-tab/centros-coste-tab.component';
import { AnalisisTabComponent } from '../analisis-tab/analisis-tab.component';
import { AjustesContablesTabComponent } from '../ajustes-contables-tab/ajustes-contables-tab.component';
import { NominasTabComponent } from '../nominas-tab/nominas-tab.component';
import { ImpuestosTabComponent } from '../impuestos-tab/impuestos-tab.component';
import { SaldosInicialesTabComponent } from '../saldos-iniciales-tab/saldos-iniciales-tab.component';
import { CierreTabComponent } from '../cierre-tab/cierre-tab.component';
import { MayorTabComponent } from '../mayor-tab/mayor-tab.component';
import { BalanceTabComponent } from '../balance-tab/balance-tab.component';
import { ResultadosTabComponent } from '../resultados-tab/resultados-tab.component';
import { LiquidacionTabComponent } from '../liquidacion-tab/liquidacion-tab.component';
import { AccountingEstate } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { JournalEntryView, JournalService } from '../../../core/journal.service';
import { ACCOUNTING_NAV_GROUPS, AccountingNavigationService, type AccountingTab as Tab } from '../../../core/accounting-navigation.service';
import { AccountingChipTabsDirective } from './accounting-chip-tabs.directive';
import { AccountingCommunitySelectorComponent } from '../accounting-community-selector/accounting-community-selector.component';

@Component({
  providers: [PageActionRegistry],
  selector: 'app-accounting-detail',
  standalone: true,
  imports: [NgTemplateOutlet,
    AccountingChipTabsDirective,
    AccountingCommunitySelectorComponent,
    AccountingAiPanelComponent, TopbarComponent, BadgeComponent, ProgressBarComponent, CurrencyPipe,
    RecibosTabComponent, TesoreriaTabComponent, DiarioTabComponent, PresupuestoTabComponent,
    MorosidadTabComponent, RemesasTabComponent, CuentasContablesTabComponent,
    CentrosCosteTabComponent, AnalisisTabComponent, AjustesContablesTabComponent,
    NominasTabComponent, ImpuestosTabComponent, SaldosInicialesTabComponent, CierreTabComponent,
    MayorTabComponent, BalanceTabComponent, ResultadosTabComponent, LiquidacionTabComponent,
  ],
  templateUrl: './accounting-detail.component.html',
  styleUrl: './accounting-detail.component.scss'
})
export class AccountingDetailComponent implements OnInit, OnDestroy {
  readonly pageActions = inject(PageActionRegistry);
  get pageTitle(): string {
    return this.tabs.find(tab => tab.id === this.activeTab())?.label || 'Resumen contable';
  }


  router = inject(Router);
  route = inject(ActivatedRoute);
  data = inject(AccountingService);
  journal = inject(JournalService);
  private readonly navigation = inject(AccountingNavigationService);
  private readonly destroyRef = inject(DestroyRef);

  activeTab = signal<Tab>('summary');
  readonly activeGroup = this.navigation.activeGroup;

  recentEntries = signal<JournalEntryView[]>([]);
  readonly currentYear = new Date().getFullYear();

  // 'suppliers' es un acceso rápido (link: true), no una pestaña local — la
  // gestión completa de Proveedores vive ahora en el Detalle de Finca, junto
  // con Personal (ver estate-detail.component). Aquí solo navegamos.
  tabs: { id: Tab; label: string; link?: boolean }[] = [
    { id: 'summary', label: 'Resumen' },
    ...ACCOUNTING_NAV_GROUPS.flatMap(group => group.items),
  ];

  goToSuppliers(): void {
    const estate = this.estate;
    if (!estate) return;
    void this.router.navigate(['/b/estates', estate.id], { queryParams: { tab: 'providers' } });
  }

  private estateData = signal<AccountingEstate | null>(null);
  private readonly navigationContext = {
    estate: this.estateData.asReadonly(),
    activeTab: this.activeTab,
  };

  get estate(): AccountingEstate | null {
    return this.estateData();
  }

  ngOnInit(): void {
    if (!this.route.snapshot.paramMap.get('id')) return;
    this.navigation.context.set(this.navigationContext);
    // NavigationEnd gives a consistent id/tab pair when Angular reuses this detail.
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      startWith(null),
      map(() => ({ id: this.route.snapshot.paramMap.get('id'), tab: this.route.snapshot.queryParamMap.get('tab') })),
      distinctUntilChanged((previous, current) => previous.id === current.id && previous.tab === current.tab),
      switchMap(({ id, tab }) => {
        // Unmount estate-bound modules before loading the next community.
        this.estateData.set(null);
        this.recentEntries.set([]);
        this.applyQueryParamDeepLink(tab);
        if (!id) return of(null);
        return from(Promise.all([
          this.data.findAccountingEstateById(id),
          this.journal.list(id, { pageSize: 5 }),
        ])).pipe(catchError(error => {
          console.error('Error cargando la contabilidad de la finca', error);
          return of(null);
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      if (!result) return;
      this.estateData.set(result[0]);
      this.recentEntries.set(result[1].items);
    });
  }

  ngOnDestroy(): void {
    if (this.navigation.context() === this.navigationContext) {
      this.navigation.context.set(null);
    }
  }

  /** `?tab=` (deep-link desde CTAs de alertas rol B, ej. "Ver remesa"/"Gestionar morosidad"). */
  private applyQueryParamDeepLink(raw: string | null): void {
    // 'movements' era la pestaña del antiguo libro de caja: los enlaces guardados llevan a Tesorería.
    const tab = raw === 'movements' ? 'treasury' : raw;
    const validTabs = this.tabs.map(t => t.id) as string[];
    this.activeTab.set(tab && validTabs.includes(tab) ? tab as Tab : 'summary');
  }

  get reservePercent(): number {
    const e = this.estate;
    if (!e || e.reserveTarget <= 0) return 0;
    return Math.round((e.reserve / e.reserveTarget) * 100);
  }

}
