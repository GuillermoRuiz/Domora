import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, setupComponent, settle, makeUser } from '../../../core/testing/component-harness';
import { AccountingDetailComponent } from './accounting-detail.component';
import type { AccountingEstate } from '../../../core/models';
import { SidebarComponent } from '../../../layout/sidebar/sidebar.component';

registerLocaleData(localeEs);

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 1000, income: 500, expenses: 200, reserve: 300, reserveTarget: 1000,
    delinquency: 0, units: 10,
    ...overrides,
  };
}

/** Asiento tal como lo manda la API del diario. */
function rawEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'j1', fiscalYear: 2026, number: 1, date: '2026-01-01T00:00:00.000Z', entryType: 'standard',
    sourceType: 'receipt_issue', sourceLabel: 'Emisión de recibo', concept: 'Cuota enero', reference: null,
    reverses: null, reversedBy: null, canReverse: false, attachments: [], total: 100, lines: [],
    ...overrides,
  };
}

function withRoute(id = 'e1', tab: string | null = null) {
  return [
    {
      provide: ActivatedRoute,
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id }),
          queryParamMap: convertToParamMap(tab ? { tab } : {}),
        },
      },
    },
  ];
}

async function flushInitialLoad(http: any, estate: AccountingEstate | null, entries: unknown[] = []): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/estates/e1/accounting/summary`).flush(estate);
  const journal = http.expectOne((r: any) => r.url === `${API}/estates/e1/journal`);
  expect(journal.request.params.get('pageSize')).toBe('5');
  journal.flush({ total: entries.length, page: 1, pageSize: 5, items: entries });
  await settle();
}

function withSidebar(tab: string | null = null) {
  TestBed.configureTestingModule({ imports: [SidebarComponent] });
  const harness = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', tab) });
  const sidebar = TestBed.createComponent(SidebarComponent);
  return { ...harness, sidebar, sidebarEl: sidebar.nativeElement as HTMLElement };
}

function openAccountingMenu(sidebar: ComponentFixture<SidebarComponent>): void {
  sidebar.detectChanges();
  const toggle = (sidebar.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.sidebar__accounting-toggle');
  if (toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click();
    sidebar.detectChanges();
  }
}

describe('AccountingDetailComponent', () => {
  it('mantiene las secciones de Contabilidad en el sidebar compartido con Fincas', async () => {
    TestBed.configureTestingModule({ imports: [SidebarComponent] });
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', 'journal') });
    const sidebar = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    sidebar.detectChanges();
    const sidebarEl = sidebar.nativeElement as HTMLElement;
    expect(sidebarEl.querySelector('.sidebar__accounting-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(sidebarEl.querySelectorAll('[data-accounting-group]')).toHaveLength(5);
    expect(sidebarEl.querySelector('[data-accounting-tab="summary"]')).not.toBeNull();
    expect(sidebarEl.querySelector('a[href="/b/estates"]')).not.toBeNull();
    expect(sidebarEl.querySelector('.sidebar__estate-toggle')).toBeNull();
    expect(el.querySelector('app-accounting-community-selector')).not.toBeNull();
    expect(el.querySelectorAll('[data-accounting-tab]')).toHaveLength(4);
  });


  it('no muestra el selector hasta que existe una comunidad contable cargada', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1') });
    fixture.detectChanges();
    expect(el.querySelector('app-accounting-community-selector')).toBeNull();
    await flushInitialLoad(http, null);
    fixture.detectChanges();
    expect(el.querySelector('app-accounting-community-selector')).toBeNull();
    expect(el.querySelector('.topbar__title')?.textContent).toBe('Contabilidad');
  });

  it('al cambiar de comunidad reutiliza la ruta, mantiene Mayor y descarta respuestas de la comunidad anterior', async () => {
    const { http } = setupComponent(AccountingDetailComponent, {
      user: makeUser({ role: 'B', administratorId: 'a1', estateIds: ['e1', 'e2', 'e3'] }),
      routes: [{ path: 'b/accounting/:id', component: AccountingDetailComponent }],
    });
    const routed = await RouterTestingHarness.create('/b/accounting/e1?tab=ledger');
    await flushInitialLoad(http, makeEstate());
    routed.detectChanges();
    const first = routed.routeDebugElement!.componentInstance;
    const el = routed.routeNativeElement!;
    expect(el.querySelector('app-mayor-tab')).not.toBeNull();
    (el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    routed.detectChanges();
    http.expectOne(`${API}/estates`).flush([
      { id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio', reserveTarget: 0 },
      { id: 'e2', administratorId: 'a1', name: 'Los Pinos', type: 'Edificio', reserveTarget: 0 },
    ]);
    await settle();
    routed.detectChanges();
    (el.querySelector('[data-community-id="e2"]') as HTMLButtonElement).click();
    await settle();
    routed.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/b/accounting/e2?tab=ledger');
    expect(routed.routeDebugElement!.componentInstance).toBe(first);
    expect(routed.routeNativeElement!.querySelector('app-mayor-tab')).toBeNull();
    const staleSummary = http.expectOne(`${API}/estates/e2/accounting/summary`);
    const staleJournal = http.expectOne(request => request.url === `${API}/estates/e2/journal`);

    await routed.navigateByUrl('/b/accounting/e3?tab=ledger');
    http.expectOne(`${API}/estates/e3/accounting/summary`).flush(makeEstate({ id: 'e3', name: 'Montealto' }));
    http.expectOne(request => request.url === `${API}/estates/e3/journal`).flush({ total: 0, page: 1, pageSize: 5, items: [] });
    await settle();
    routed.detectChanges();
    expect(routed.routeNativeElement!.querySelector('.community-selector__trigger')?.textContent).toContain('Montealto');
    expect(routed.routeNativeElement!.querySelector('app-mayor-tab')).not.toBeNull();
    http.expectOne(`${API}/estates/e3/chart-accounts`).flush([]);
    staleSummary.flush(makeEstate({ id: 'e2', name: 'Los Pinos' }));
    staleJournal.flush({ total: 0, page: 1, pageSize: 5, items: [] });
    await settle();
    routed.detectChanges();
    expect(routed.routeNativeElement!.querySelector('.community-selector__trigger')?.textContent).toContain('Montealto');
    expect(first.activeTab()).toBe('ledger');
  });

  it('carga la finca y sus últimos asientos según el :id de la ruta', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate({ name: 'Edificio Sol' }), [rawEntry()]);
    fixture.detectChanges();

    expect(el.querySelector('.community-selector__trigger')?.textContent).toContain('Edificio Sol');
    expect(el.querySelectorAll('.community-selector__trigger')).toHaveLength(1);
    expect(el.querySelector('.estate-header')).toBeNull();
    expect(el.querySelector('.header-kpis')).toBeNull();
    expect(el.querySelector('.back-btn')).toBeNull();
    const rows = el.querySelectorAll('.movements-preview tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('2026-01-01');
    expect(rows[0].textContent).toContain('Emisión de recibo');
  });

  it('el enlace antiguo ?tab=movements lleva a Tesorería', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', 'movements') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();

    expect(el.querySelector('app-tesoreria-tab')).not.toBeNull();
  });

  it('el deep-link ?tab= abre directamente esa pestaña', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', 'delinquency') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();

    expect(el.querySelector('app-morosidad-tab')).not.toBeNull();
    expect(el.querySelector('.summary-layout')).toBeNull();
  });

  it('un valor de ?tab= inválido se ignora y se queda en el resumen', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', 'algo-que-no-existe') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();

    expect(el.querySelector('.summary-layout')).not.toBeNull();
  });

  it('Proveedores dentro de Cobros y tesorería sigue navegando a la misma finca', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar();
    fixture.detectChanges();
    sidebar.detectChanges();
    await flushInitialLoad(http, makeEstate({ id: 'e1' }));
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    openAccountingMenu(sidebar);
    (sidebarEl.querySelector('[data-accounting-group="collections"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-accounting-tab="suppliers"]') as HTMLButtonElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/b/estates', 'e1'], { queryParams: { tab: 'providers' } });
    expect(el.querySelector('app-recibos-tab')).not.toBeNull(); // el enlace no cambia la selección local
  });

  it('el lateral solo muestra los cinco títulos y cada uno abre sus opciones debajo del encabezado', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar();
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    openAccountingMenu(sidebar);

    expect(el.querySelector('.accounting-subnav')).toBeNull();
    expect(sidebarEl.querySelector('.accounting-nav details')).toBeNull();
    expect(sidebarEl.querySelector('.accounting-nav__children')).toBeNull();
    expect(sidebarEl.querySelector('.accounting-nav__suppliers')).toBeNull();
    expect(sidebarEl.textContent).not.toContain('Edificio Sol');
    const groups = Array.from(sidebarEl.querySelectorAll<HTMLButtonElement>('[data-accounting-group]'));
    expect(groups.map(group => group.textContent?.trim())).toEqual([
      'Cobros y tesorería', 'Libros y cuentas', 'Presupuesto y análisis',
      'Nóminas e impuestos', 'Ejercicio y configuración',
    ]);
    const expectedOptions = [
      ['Recibos', 'Remesas', 'Morosidad', 'Tesorería', 'Proveedores'],
      ['Diario', 'Mayor', 'Balance', 'Cuentas contables'],
      ['Presupuesto', 'Resultados', 'Análisis', 'Liquidación de caja'],
      ['Nóminas', 'Impuestos'],
      ['Saldos iniciales', 'Cierre', 'Centros de coste', 'Configuración'],
    ];
    expect(sidebarEl.querySelector('[data-accounting-tab="summary"]')?.getAttribute('aria-current')).toBe('page');
    groups.forEach((group, index) => {
      group.click();
      fixture.detectChanges();
      expect(Array.from(el.querySelectorAll('.accounting-subnav button')).map(button => button.textContent?.trim())).toEqual(expectedOptions[index]);
      expect(el.querySelector('.page-content')?.firstElementChild?.classList.contains('accounting-subnav')).toBe(true);
    });
  });

  it('seleccionar Diario desde el lateral muestra el mismo módulo sin abandonar la finca', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar();
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    openAccountingMenu(sidebar);
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (sidebarEl.querySelector('[data-accounting-group="books"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    sidebar.detectChanges();

    expect(el.querySelector('app-diario-tab')).not.toBeNull();
    expect(el.querySelector('.summary-layout')).toBeNull();
    expect(el.querySelector('[data-accounting-tab="journal"]')?.getAttribute('aria-current')).toBe('page');
    expect(sidebarEl.querySelector('[data-accounting-group="books"]')?.getAttribute('aria-current')).toBe('page');
    expect(navigateSpy).not.toHaveBeenCalled();
    http.expectNone(request => request.method !== 'GET');

    (sidebarEl.querySelector('[data-accounting-tab="summary"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.summary-layout')).not.toBeNull();
    expect(el.querySelector('.accounting-subnav')).toBeNull();
  });

  it('un enlace antiguo marca Cobros y tesorería y muestra Tesorería en el menú horizontal', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar('movements');
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    sidebar.detectChanges();

    const treasury = el.querySelector('[data-accounting-tab="treasury"]');
    expect(el.querySelector('app-tesoreria-tab')).not.toBeNull();
    expect(treasury?.getAttribute('aria-current')).toBe('page');
    expect(sidebarEl.querySelector('[data-accounting-group="collections"]')?.getAttribute('aria-current')).toBe('page');
  });

  it.each([
    ['receipts', 'app-recibos-tab'], ['remesas', 'app-remesas-tab'],
    ['delinquency', 'app-morosidad-tab'], ['treasury', 'app-tesoreria-tab'],
    ['ledger', 'app-mayor-tab'], ['balance', 'app-balance-tab'],
    ['accounts', 'app-cuentas-contables-tab'], ['budget', 'app-presupuesto-tab'],
    ['results', 'app-resultados-tab'], ['analysis', 'app-analisis-tab'],
    ['cash-settlement', 'app-liquidacion-tab'], ['payroll', 'app-nominas-tab'],
    ['taxes', 'app-impuestos-tab'], ['opening', 'app-saldos-iniciales-tab'],
    ['closing', 'app-cierre-tab'], ['cost-centres', 'app-centros-coste-tab'],
    ['settings', 'app-ajustes-contables-tab'],
  ])('la opción horizontal %s conserva su componente contable', async (tab, selector) => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar(tab);
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    sidebar.detectChanges();

    (el.querySelector(`[data-accounting-tab="${tab}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector(selector)).not.toBeNull();
    expect(el.querySelector('.community-selector__trigger')?.textContent).toContain('Edificio Sol');
    expect(el.querySelector('app-accounting-ai-panel .ai-panel') !== null).toBe(tab === 'treasury');
    if (tab !== 'treasury') expect(el.querySelector('app-accounting-ai-panel')).toBeNull();
    http.expectNone(request => request.method !== 'GET');
  });

  it('Resumen muestra solo las propuestas pendientes y su botón abre la conciliación completa en Tesorería', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar();
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    http.expectOne(request => request.url === `${API}/estates/e1/ai/reconciliation`).flush({
      counts: { bankMovements: 10, automaticallyReconciled: 4, manuallyReconciled: 0, suggested: 6, unmatched: 0 },
      data: [], total: 2, page: 1, pageSize: 30,
    });
    await settle();
    fixture.detectChanges();

    const notice = el.querySelector('.reconciliation-notice');
    expect(notice?.textContent).toContain('2 propuestas');
    expect(el.querySelector('app-accounting-ai-panel .ai-panel')).toBeNull();
    expect(el.querySelector('.summary-layout')).not.toBeNull();
    (notice?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    sidebar.detectChanges();

    expect(el.querySelector('.reconciliation-notice')).toBeNull();
    expect(el.querySelector('app-accounting-ai-panel .ai-panel')).not.toBeNull();
    expect(el.querySelector('app-tesoreria-tab')).not.toBeNull();
    expect(el.querySelector('.page-content')?.firstElementChild?.classList.contains('accounting-subnav')).toBe(true);
    expect(sidebarEl.querySelector('[data-accounting-group="collections"]')?.getAttribute('aria-current')).toBe('page');
    http.expectNone(request => request.method !== 'GET');
  });

  it('Resumen no muestra el aviso si no hay propuestas pendientes', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    http.expectOne(request => request.url === `${API}/estates/e1/ai/reconciliation`).flush({
      counts: { bankMovements: 10, automaticallyReconciled: 10, manuallyReconciled: 0, suggested: 0, unmatched: 0 },
      data: [], total: 0, page: 1, pageSize: 30,
    });
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.reconciliation-notice')).toBeNull();
    expect(el.querySelector('app-accounting-ai-panel .ai-panel')).toBeNull();
    expect(el.querySelector('.summary-layout')).not.toBeNull();
  });

  it('el fondo de los chips sigue la opción activa y se adapta al cambiar de fila', async () => {
    let balanceTop = 12;
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['accountingTab'] === 'balance' ? 132 : 12;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['accountingTab'] === 'balance' ? balanceTop : 12;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(112);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    try {
      const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1', 'ledger') });
      fixture.detectChanges();
      await flushInitialLoad(http, makeEstate());
      fixture.detectChanges();
      const nav = el.querySelector<HTMLElement>('.accounting-subnav')!;
      const pill = nav.querySelector('.accounting-subnav__indicator');
      expect(pill?.getAttribute('aria-hidden')).toBe('true');
      expect(nav.style.getPropertyValue('--chip-x')).toBe('12px');
      expect(nav.style.getPropertyValue('--chip-width')).toBe('112px');

      (nav.querySelector('[data-accounting-tab="balance"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(nav.style.getPropertyValue('--chip-x')).toBe('132px');
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(el.querySelector('app-balance-tab')).not.toBeNull();

      balanceTop = 64;
      resized!();
      expect(nav.style.getPropertyValue('--chip-y')).toBe('64px');
      fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('pulsar el título de la sección activa mantiene el módulo seleccionado', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar('ledger');
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    openAccountingMenu(sidebar);

    (sidebarEl.querySelector('[data-accounting-group="books"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('app-mayor-tab')).not.toBeNull();
    expect(el.querySelector('[data-accounting-tab="ledger"]')?.getAttribute('aria-current')).toBe('page');
    (el.querySelector('[data-accounting-tab="balance"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('app-balance-tab')).not.toBeNull();
    expect(el.querySelector('app-mayor-tab')).toBeNull();
  });

  it('al salir del detalle desaparecen las opciones de esa finca del lateral', async () => {
    const { fixture, http, sidebar, sidebarEl } = withSidebar();
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    sidebar.detectChanges();
    expect(sidebarEl.querySelector('.accounting-nav')).not.toBeNull();

    fixture.destroy();
    sidebar.detectChanges();

    expect(sidebarEl.querySelector('.accounting-nav')).toBeNull();
    expect(sidebarEl.textContent).toContain('Contabilidad');
  });

  it('seleccionar una comunidad despliega Contabilidad y el chevron permite cerrarla y abrirla sin navegar', async () => {
    const { fixture, http, el, sidebar, sidebarEl } = withSidebar('ledger');
    fixture.detectChanges();
    sidebar.detectChanges();
    expect(sidebarEl.querySelector('.sidebar__accounting-toggle')).toBeNull();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    sidebar.detectChanges();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const toggle = sidebarEl.querySelector<HTMLButtonElement>('.sidebar__accounting-toggle')!;
    const children = sidebarEl.querySelector<HTMLElement>('#accounting-sidebar-sections')!;
    const chevron = toggle.querySelector('.sidebar__chevron')!;

    expect(toggle.textContent).toContain('Contabilidad');
    expect(toggle.getAttribute('aria-controls')).toBe(children.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(children.hasAttribute('inert')).toBe(false);
    expect(children.getAttribute('aria-hidden')).toBe('false');
    expect(chevron.classList.contains('sidebar__chevron--open')).toBe(true);
    expect(toggle.lastElementChild).toBe(chevron);
    expect(children.querySelectorAll('[data-accounting-group]')).toHaveLength(5);
    expect(children.querySelector('[data-accounting-tab="summary"]')).not.toBeNull();

    toggle.click();
    sidebar.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(children.hasAttribute('inert')).toBe(true);
    expect(chevron.classList.contains('sidebar__chevron--open')).toBe(false);

    (el.querySelector('[data-accounting-tab="journal"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    sidebar.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    (el.querySelector('[data-accounting-tab="ledger"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    toggle.click();
    sidebar.detectChanges();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(children.hasAttribute('inert')).toBe(false);
    expect(chevron.classList.contains('sidebar__chevron--open')).toBe(true);
    expect(el.querySelector('app-mayor-tab')).not.toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();

    fixture.destroy();
    sidebar.detectChanges();
    expect(sidebarEl.querySelector('.sidebar__accounting-toggle')).toBeNull();
    expect(sidebarEl.querySelector('a[href="/b/accounting"]')).not.toBeNull();
  });

  it('"Ver todas las fincas" del selector navega al listado de contabilidad', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate());
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('.community-selector__all') as HTMLButtonElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/b/accounting']);
  });

  it('el resultado del ejercicio en el resumen es ingresos menos gastos', async () => {
    const { fixture, http, el } = setupComponent(AccountingDetailComponent, { providers: withRoute('e1') });
    fixture.detectChanges();
    await flushInitialLoad(http, makeEstate({ income: 500, expenses: 200 }));
    fixture.detectChanges();

    const totalRow = Array.from(el.querySelectorAll('.tr--total .td--money')).find(Boolean);
    expect(totalRow?.textContent).toContain('300');
  });
});
