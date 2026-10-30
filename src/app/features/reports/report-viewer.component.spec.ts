import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { By } from '@angular/platform-browser';
import { API, ComponentHarness, setupComponent, settle } from '../../core/testing/component-harness';
import { ReportViewerComponent } from './report-viewer.component';
import { ReportFiltersComponent } from './report-filters.component';
import { TEST_CATALOG, TEST_RESULT } from './reporting.fixtures.spec-helper';

describe('ReportViewerComponent', () => {
  let h: ComponentHarness<ReportViewerComponent>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({}));
    h = setupComponent(ReportViewerComponent, { providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'trial-balance' } }, queryParamMap: params } },
    ] });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => { h.http.verify(); vi.restoreAllMocks(); });
  async function load(): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    h.http.expectOne(`${API}/reports/estates`).flush([{ id: 'e1', name: 'Comunidad Sol' }, { id: 'e2', name: 'Comunidad Luna' }]);
    await settle(); h.fixture.detectChanges();
  }
  it('exige una comunidad y solo consulta al generar; muestra dinero y advertencias', async () => {
    await load();
    expect(h.el.querySelector('.topbar app-report-estate-scope-selector')).not.toBeNull();
    expect(h.el.querySelector('.viewer-configuration app-report-estate-scope-selector')).toBeNull();
    h.http.expectNone(`${API}/reports/trial-balance/query`);
    await h.component.generate();
    expect(h.component.error()).toContain('una comunidad');
    h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    const generated = h.component.generate();
    const req = h.http.expectOne(`${API}/reports/trial-balance/query`);
    expect(req.request.body.estateIds).toEqual(['e1']);
    req.flush(TEST_RESULT); await generated; h.fixture.detectChanges();
    expect(h.el.textContent).toContain('400,00 €');
    expect(h.el.textContent).toContain('Importes del ejercicio seleccionado.');
    expect(h.el.textContent).toContain('Exportar PDF');
    h.component.updateInput({ ...h.component.input(), fiscalYear: 2025 }); h.fixture.detectChanges();
    expect(h.component.result()).toBeNull();
    expect(h.el.textContent).not.toContain('Exportar PDF');
  });
  it('conserva la comunidad al editar el ejercicio antes de que el hijo reciba el nuevo scope', async () => {
    await load();
    const filters = h.fixture.debugElement.query(By.directive(ReportFiltersComponent)).componentInstance as ReportFiltersComponent;
    h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    // Same-frame events, as reproduced by selecting a radio then editing the year.
    // The filter child's input still contains the previous, empty selection.
    filters.period({ fiscalYear: 2025 });
    expect(h.component.input().estateIds).toEqual(['e1']);
    const generated = h.component.generate();
    const request = h.http.expectOne(`${API}/reports/trial-balance/query`);
    expect(request.request.body).toMatchObject({ estateIds: ['e1'], fiscalYear: 2025 });
    request.flush(TEST_RESULT); await generated;
  });
  it('carga los filtros dependientes cuando Todas contiene una sola comunidad', async () => {
    h.component.catalog.set({ ...TEST_CATALOG, reports: [{ ...TEST_CATALOG.reports[0], scopeMode: 'multiple', filters: ['propertyId'] }] });
    h.component.estates.set([{ id: 'e1', name: 'Comunidad Sol' }]);
    h.component.input.set({ scopeMode: 'all', estateIds: [] });
    const loaded = h.component.loadOptions();
    h.http.expectOne(`${API}/estates/e1/properties`).flush([{ id: 'p1', ref: 'Local' }]);
    await loaded;
    expect(h.component.singleEstate()).toBe(true);
    expect(h.component.properties()).toEqual([{ id: 'p1', name: 'Local' }]);
  });
  it('ignora una respuesta de filtros anteriores y conserva errores de autorización', async () => {
    await load(); h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    const generated = h.component.generate();
    const req = h.http.expectOne(`${API}/reports/trial-balance/query`);
    h.component.updateInput({ ...h.component.input(), fiscalYear: 2025 }); req.flush(TEST_RESULT); await generated;
    expect(h.component.result()).toBeNull();
    const forbidden = h.component.generate();
    h.http.expectOne(`${API}/reports/trial-balance/query`).flush({}, { status: 403, statusText: 'Forbidden' });
    await forbidden; h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No tienes permiso');
    expect(h.el.textContent).not.toContain('No hay datos para estos filtros');
  });
  it('mantiene metadatos y advertencias cuando el resultado está vacío', async () => {
    await load(); h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    const generated = h.component.generate();
    h.http.expectOne(`${API}/reports/trial-balance/query`).flush({ ...TEST_RESULT, rowCount: 0, sections: [] });
    await generated; h.fixture.detectChanges();
    expect(h.el.textContent).toContain('No hay datos para estos filtros');
    expect(h.el.textContent).toContain('Importes del ejercicio seleccionado.');
    expect(h.el.textContent).toContain('Comunidad Sol');
    expect(h.el.textContent).toContain('Ejercicio 2026');
  });
  it('descarga el blob y un fallo de export permite reintentar sin éxito ficticio', async () => {
    await load(); h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    const generated = h.component.generate(); h.http.expectOne(`${API}/reports/trial-balance/query`).flush(TEST_RESULT); await generated;
    const failed = h.component.exportReport('xlsx');
    h.http.expectOne(`${API}/reports/trial-balance/export`).flush(new Blob(), { status: 500, statusText: 'Server Error' });
    await failed;
    expect(h.component.exportError()).toBeTruthy(); expect(h.component.exporting()).toBeNull();
    const objectUrl = vi.fn(() => 'blob:report'); const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: objectUrl, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const downloaded = h.component.exportReport('pdf');
    h.http.expectOne(`${API}/reports/trial-balance/export`).flush(new Blob(['%PDF-1.7'])); await downloaded;
    expect(click).toHaveBeenCalled(); expect(objectUrl).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith('blob:report');
    expect(h.component.exportError()).toBe(''); click.mockRestore(); vi.unstubAllGlobals();
  });
  it('muestra la referencia y caducidad de la versión y la incluye al exportar', async () => {
    await load(); h.component.changeScope({ scopeMode: 'selected', estateIds: ['e1'] });
    const generated = h.component.generate();
    h.http.expectOne(`${API}/reports/trial-balance/query`).flush({ ...TEST_RESULT, metadata: {
      ...TEST_RESULT.metadata, snapshotId: 'snapshot-1', snapshotExpiresAt: '2026-11-14T10:00:00Z',
    } });
    await generated; h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Referencia de la versión: snapshot-1');
    expect(h.el.textContent).toContain('14/11/2026');
    const exported = h.component.exportReport('pdf');
    const request = h.http.expectOne(`${API}/reports/trial-balance/export`);
    expect(request.request.body.snapshotId).toBe('snapshot-1');
    request.flush(new Blob(), { status: 500, statusText: 'Server Error' }); await exported;
  });
  it('hereda la comunidad del catálogo y mantiene el ámbito en los enlaces de regreso', async () => {
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e2' }));
    await load();
    expect(h.component.input().estateIds).toEqual(['e2']);
    expect(h.el.querySelector('.topbar .scope-trigger')?.textContent).toContain('Comunidad Luna');
    expect(h.el.querySelector('a.viewer-back')?.getAttribute('href')).toContain('estateIds=e2');
    const generated = h.component.generate();
    const request = h.http.expectOne(`${API}/reports/trial-balance/query`);
    expect(request.request.body).toMatchObject({ scopeMode: 'selected', estateIds: ['e2'] });
    request.flush(TEST_RESULT); await generated;
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e1' }));
    expect(h.component.result()).toBeNull();
    expect(h.component.input().estateIds).toEqual(['e1']);
  });
  it('no amplía a Todas una selección múltiple al abrir un informe de comunidad única', async () => {
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e1,e2' }));
    await load();
    expect(h.component.selection()).toEqual({ scopeMode: 'selected', estateIds: [] });
    await h.component.generate();
    h.http.expectNone(`${API}/reports/trial-balance/query`);
    expect(h.component.error()).toContain('una comunidad');
  });
  it('aplica la comunidad nueva durante la carga inicial e ignora las opciones anteriores', async () => {
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e1' }));
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/reports/catalog`).flush({ ...TEST_CATALOG, reports: [{ ...TEST_CATALOG.reports[0], filters: ['propertyId'] }] });
    h.http.expectOne(`${API}/reports/estates`).flush([{ id: 'e1', name: 'Sol' }, { id: 'e2', name: 'Luna' }]);
    await settle();
    const old = h.http.expectOne(`${API}/estates/e1/properties`);
    params.next(convertToParamMap({ scopeMode: 'selected', estateIds: 'e2' }));
    h.http.expectOne(`${API}/estates/e2/properties`).flush([{ id: 'p2', ref: 'Luna 2A' }]);
    await settle();
    old.flush([{ id: 'p1', ref: 'Sol 1A' }]);
    await settle();
    expect(h.component.input().estateIds).toEqual(['e2']);
    expect(h.component.properties()).toEqual([{ id: 'p2', name: 'Luna 2A' }]);
  });
});
