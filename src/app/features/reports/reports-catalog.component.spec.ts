import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { API, ComponentHarness, setupComponent, settle } from '../../core/testing/component-harness';
import { ReportsCatalogComponent } from './reports-catalog.component';
import { TEST_CATALOG } from './reporting.fixtures.spec-helper';

describe('ReportsCatalogComponent', () => {
  let h: ComponentHarness<ReportsCatalogComponent>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({}));
    h = setupComponent(ReportsCatalogComponent, { providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } }, queryParamMap: params } },
    ] });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/estates`).flush([{ id: 'e1', name: 'Comunidad Sol' }, { id: 'e2', name: 'Comunidad Luna' }]);
  });
  afterEach(() => { h.http.verify(); vi.restoreAllMocks(); });
  it('muestra categorías con conteos reales y oculta definiciones deshabilitadas', async () => {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    await settle(); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.report-card')).toHaveLength(1);
    expect(h.el.querySelector('a.report-card')?.getAttribute('href')).toBe('/b/reports/category/finance');
    expect(h.el.textContent).toContain('1 informe');
    expect(h.el.textContent).not.toContain('No disponible');
    expect(h.el.textContent).not.toContain('Balance de sumas y saldos');
    expect(h.el.querySelector('.topbar app-report-estate-scope-selector')).not.toBeNull();
  });
  it('busca localmente sin tildes por título, descripción y categoría', async () => {
    h.fixture.detectChanges(); h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    await settle();
    for (const term of ['SITUACION', 'SUMAS', 'finanzas']) {
      h.component.search.set(term); h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Balance de sumas y saldos');
      expect(h.el.querySelector('a.report-card')?.getAttribute('href')).toBe('/b/reports/view/trial-balance');
    }
    h.component.search.set('inexistente'); h.fixture.detectChanges();
    expect(h.el.textContent).toContain('No hay informes que coincidan');
    h.http.expectNone(`${API}/reports/catalog`);
  });
  it('presenta un 403 como error con reintento', async () => {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush({}, { status: 403, statusText: 'Forbidden' });
    await settle(); h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No tienes permiso');
    expect(h.el.textContent).not.toContain('No hay informes que coincidan');
  });
  it('muestra las siete categorías que entrega el catálogo y un único selector en el header', async () => {
    const categories = ['portfolio', 'finance', 'collections', 'budgets', 'operations', 'meetings-tax', 'intelligence']
      .map(key => ({ key, title: key, description: key, icon: 'chart' }));
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush({ categories, reports: [] });
    await settle(); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('a.report-card')).toHaveLength(7);
    expect(h.el.querySelectorAll('app-report-estate-scope-selector')).toHaveLength(1);
  });
  it('presenta el fallo 500 como carga del catálogo y permite reintentar hasta recuperar las cards', async () => {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush({}, { status: 500, statusText: 'Internal Server Error' });
    await settle(); h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"] h3')?.textContent).toBe('No se han podido cargar los informes');
    expect(h.el.textContent).toContain('Vuelve a intentarlo. Si el problema continúa, comprueba que el servicio está disponible.');
    expect(h.el.textContent).not.toContain('No se ha podido generar el informe');
    (h.el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/estates`).flush([{ id: 'e1', name: 'Comunidad Sol' }]);
    h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    await settle(); h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
    expect(h.el.querySelectorAll('a.report-card')).toHaveLength(1);
  });
  it.each([[], { categories: [], reports: [] }])('presenta un catálogo vacío 200 como vacío, sin error: %j', async response => {
    h.fixture.detectChanges(); h.http.expectOne(`${API}/reports/catalog`).flush(response);
    await settle(); h.fixture.detectChanges();
    expect(h.el.textContent).toContain('No hay informes disponibles');
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
    expect(h.el.querySelectorAll('a.report-card')).toHaveLength(0);
  });
  it('encuentra morosidad sin nuevas llamadas y mantiene la búsqueda equivalente sin tildes', async () => {
    const category = { key: 'collections', title: 'Cobros y morosidad', description: 'Recibos y deuda.', icon: 'chart' };
    const report = { ...TEST_CATALOG.reports[0], key: 'debt-aging', category: category.key, title: 'Antigüedad de morosidad' };
    h.fixture.detectChanges(); h.http.expectOne(`${API}/reports/catalog`).flush({ categories: [category], reports: [report] });
    await settle();
    for (const term of ['MOROSIDAD', 'ANTIGÜEDAD', 'antiguedad']) {
      h.component.search.set(term); h.fixture.detectChanges();
      expect(h.el.querySelectorAll('a.report-card')).toHaveLength(1);
      expect(h.el.textContent).toContain(report.title);
    }
    h.http.expectNone(`${API}/reports/catalog`);
  });
  it('conserva la selección al entrar en categorías, informes y usar un enlace compartido', async () => {
    h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    await settle();
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e2' }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('a.report-card')?.getAttribute('href')).toContain('estateIds=e2');
    expect(h.el.querySelector('.topbar .scope-trigger')?.textContent).toContain('Comunidad Luna');
    h.component.search.set('sumas'); h.fixture.detectChanges();
    expect(h.el.querySelector('a.report-card')?.getAttribute('href')).toContain('/b/reports/view/trial-balance?');
    expect(h.component.scopeParams()).toEqual({ scopeMode: 'selected', estateIds: 'e2' });
  });
});
