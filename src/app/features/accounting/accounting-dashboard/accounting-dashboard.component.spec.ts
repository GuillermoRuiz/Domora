import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import { AccountingDashboardComponent } from './accounting-dashboard.component';
import type { AccountingEstate, Debtor } from '../../../core/models';

registerLocaleData(localeEs);

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 1000, income: 500, expenses: 200, reserve: 300, reserveTarget: 1000,
    delinquency: 0, units: 10,
    ...overrides,
  };
}

/** `DebtorsService.listDebtors()` mapea la respuesta cruda del backend (`titular`, `property` como objeto) a `Debtor` — esta fábrica envía esa forma cruda. */
function makeDebtor(overrides: { name?: string; amount?: number } = {}): any {
  return {
    id: 'd1', administratorId: 'a1', estateId: 'e1', propertyId: 'p1',
    titular: overrides.name ?? 'Juan Moroso',
    property: { ref: '3A', staircase: null, floor: null, door: null },
    amount: overrides.amount ?? 200, interest: 5, monthsOverdue: 2, oldest: '2026-01-01', lastContact: null,
    reminderL1: false, reminderL2: false, reminderBf: false, step: 'aviso',
  };
}

/** El pipe `currency` separa el importe del símbolo con un espacio no separable (NBSP) — se normaliza para comparar con un string normal. */
function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s/g, ' ').trim();
}

async function flushInitialLoad(http: any, estates: AccountingEstate[], debtors: Debtor[] = []): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/estates`).flush(estates.map((e) => ({ id: e.id, administratorId: e.administratorId, name: e.name, type: e.type, address: e.address, streetNumber: e.streetNumber, location: e.location, catastroFacadeUrl: e.catastroFacadeUrl })));
  await settle();
  for (const e of estates) {
    http.expectOne((r: any) => r.url === `${API}/estates/${e.id}/accounting/summary`).flush(e);
  }
  await settle();
  http.expectOne((r: any) => r.url === `${API}/debtors`).flush(debtors);
  await settle();
}

describe('AccountingDashboardComponent', () => {
  beforeEach(() => localStorage.removeItem('domora-accounting-view'));

  it('cambia entre tabla y tarjetas conservando los filtros y los importes contables', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate(), makeEstate({ id: 'e2', name: 'Torre Norte', balance: 2500 })]);
    fixture.detectChanges();
    const search = el.querySelector<HTMLInputElement>('.local-search input')!;
    expect(search).not.toBeNull();
    search.value = 'torre';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('[aria-label="Vista tarjetas"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelectorAll('.accounting-card')).toHaveLength(1);
    expect(norm(el.querySelector('.accounting-card')?.textContent)).toContain('2.500,00 €');
    expect(localStorage.getItem('domora-accounting-view')).toBe('cards');
    (el.querySelector('[aria-label="Vista tabla"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector('tbody')?.textContent).toContain('Torre Norte');
  });

  it('el menú Filtrar combina tipo y morosidad, y permite limpiar los filtros', async () => {
    const { fixture, http, el, component } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate(), makeEstate({ id: 'e2', type: 'Garaje', delinquency: 90 })]);
    fixture.detectChanges();
    (el.querySelector('.filter-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.filters-menu')).not.toBeNull();
    component.filterType.set('Garaje');
    component.filterDelinquency.set('Con morosidad');
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    (el.querySelector('.clear-filters') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('busca por dirección sin distinguir acentos y muestra cómo limpiar una búsqueda vacía', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate({ address: 'Calle Alcalá', streetNumber: '12', location: 'Madrid' })]);
    fixture.detectChanges();
    const search = el.querySelector<HTMLInputElement>('.local-search input')!;
    search.value = 'alcala 12';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    search.value = 'inexistente';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('.feedback-card')?.textContent).toContain('No hay comunidades que coincidan');
    (el.querySelector('.feedback-card button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('un fallo al cargar muestra Reintentar y recupera el listado sin presentar ceros como datos', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/estates`).flush({}, { status: 500, statusText: 'Error' });
    // La petición a /debtors seguía en curso cuando /estates falló (se piden en paralelo): hay que drenarla antes de reintentar.
    http.expectOne((r: any) => r.url === `${API}/debtors`).flush([]);
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
    expect(el.querySelectorAll('.summary-value')).toHaveLength(0);
    (el.querySelector('.feedback-card button') as HTMLButtonElement).click();
    await flushInitialLoad(http, [makeEstate()]);
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    log.mockRestore();
  });

  it('el listado contable muestra el selector y la búsqueda del encabezado', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate(), makeEstate({ id: 'e2', name: 'Torre Norte' })]);
    fixture.detectChanges();
    expect(el.querySelector('.topbar .community-selector__trigger')?.textContent).toContain('Todas mis comunidades');
    const search = el.querySelector<HTMLInputElement>('.topbar input[type="search"]')!;
    expect(search).not.toBeNull();
    search.value = 'torre';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector('tbody')?.textContent).toContain('Torre Norte');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });
  it('muestra los totales consolidados en el resumen compacto', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [
      makeEstate({ id: 'e1', balance: 1000, income: 500, expenses: 200, delinquency: 100 }),
      makeEstate({ id: 'e2', balance: 2000, income: 300, expenses: 100, delinquency: 0 }),
    ]);
    fixture.detectChanges();

    const stats = el.querySelectorAll('.summary-value');
    expect(norm(stats[0].textContent)).toBe('3.000,00 €'); // saldo consolidado
    expect(norm(stats[1].textContent)).toBe('100,00 €'); // morosidad
    expect(stats).toHaveLength(2);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('muestra la alerta de morosos de todas las comunidades', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate()], [makeDebtor({ name: 'Juan Moroso', amount: 200 })]);
    fixture.detectChanges();

    expect(el.querySelector('.alert-card')?.textContent).toContain('Juan Moroso');
    expect(norm(el.querySelector('.debtor-amount')?.textContent)).toBe('200,00 €');
  });

  it('sin morosos, no muestra la alerta', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate()]);
    fixture.detectChanges();

    expect(el.querySelector('.alert-card')).toBeNull();
  });

  describe('filtros', () => {
    it('la búsqueda filtra por nombre', async () => {
      const { fixture, http, component, el } = setupComponent(AccountingDashboardComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeEstate({ id: 'e1', name: 'Edificio Sol' }), makeEstate({ id: 'e2', name: 'Torre Norte' })]);
      fixture.detectChanges();

      component.searchName.set('torre');
      fixture.detectChanges();

      expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    });

    it('el filtro de morosidad separa "al corriente" de "con morosidad"', async () => {
      const { fixture, http, component, el } = setupComponent(AccountingDashboardComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [
        makeEstate({ id: 'e1', delinquency: 0 }),
        makeEstate({ id: 'e2', delinquency: 50 }),
      ]);
      fixture.detectChanges();

      component.filterDelinquency.set('Con morosidad');
      fixture.detectChanges();
      expect(el.querySelectorAll('tbody tr')).toHaveLength(1);

      component.filterDelinquency.set('Al corriente');
      fixture.detectChanges();
      expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    });
  });

  it('ordenar por una columna invierte la dirección al pulsarla de nuevo', async () => {
    const { fixture, http, component, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate({ id: 'e1', balance: 100 }), makeEstate({ id: 'e2', balance: 500 })]);
    fixture.detectChanges();

    (Array.from(el.querySelectorAll('.th--sortable')).find((th) => th.textContent?.includes('Saldo')) as HTMLElement).click();
    fixture.detectChanges();
    expect(component.sortDirection()).toBe('asc');
    expect(component.sortedEstates()[0].balance).toBe(100);

    (Array.from(el.querySelectorAll('.th--sortable')).find((th) => th.textContent?.includes('Saldo')) as HTMLElement).click();
    fixture.detectChanges();
    expect(component.sortDirection()).toBe('desc');
    expect(component.sortedEstates()[0].balance).toBe(500);
  });

  it('al hacer click en una finca, navega a su detalle contable', async () => {
    const { fixture, http, el } = setupComponent(AccountingDashboardComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeEstate({ id: 'e7' })]);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.community-name') as HTMLButtonElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/b/accounting', 'e7']);
  });

  describe('generar recibos', () => {
    it('sin finca ni periodo válido, muestra el error y no envía nada', async () => {
      const { fixture, http, el, component } = setupComponent(AccountingDashboardComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeEstate({ id: 'e1' }), makeEstate({ id: 'e2' })]);
      fixture.detectChanges();

      component.openGenerarRecibos();
      component.grEstateId.set('');
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Generar recibos')) as HTMLElement).click();
      fixture.detectChanges();

      expect(component.grError()).toContain('Elige una finca');
      http.expectNone((r: any) => r.url.includes('/receipts/generate'));
    });

    it('con finca y periodo válidos, genera los recibos y muestra el resultado', async () => {
      const { fixture, http, el, component } = setupComponent(AccountingDashboardComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeEstate({ id: 'e1' })]);
      fixture.detectChanges();

      component.openGenerarRecibos();
      component.grEstateId.set('e1');
      component.grPeriodKey.set('2026-03');
      fixture.detectChanges();

      const submitPromise = component.submitGenerarRecibos();
      const req = http.expectOne((r: any) => r.url === `${API}/estates/e1/receipts/generate` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ periodKey: '2026-03' });
      req.flush({ created: 8, skipped: 2, totalProperties: 10 });
      await submitPromise;
      fixture.detectChanges();

      expect(el.textContent).toContain('8');
      expect(el.textContent).toContain('ya existían para este periodo');
    });
  });
});
