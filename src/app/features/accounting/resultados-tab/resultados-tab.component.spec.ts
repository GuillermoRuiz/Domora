import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { ResultadosTabComponent } from './resultados-tab.component';

const YEAR = new Date().getFullYear();

describe('ResultadosTabComponent', () => {
  let h: ComponentHarness<ResultadosTabComponent>;

  beforeEach(() => {
    h = setupComponent(ResultadosTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  it('muestra presupuestado, ejecutado y la desviación', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/budget-vs-actual` && r.params.get('fiscalYear') === String(YEAR))
      .flush({
        estate: { name: 'Sol', cif: null }, fiscalYear: YEAR,
        rows: [{ code: '622', name: 'Mantenimiento', budgeted: 1000, executed: 1200, deviation: 200 }],
        totalBudgeted: 1000, totalExecuted: 1200,
      });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Mantenimiento');
    expect(h.el.textContent).toContain('200,00 €');
  });

  it('cambia de ejercicio y vuelve a pedir el informe', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/budget-vs-actual`)
      .flush({ estate: { name: 'Sol', cif: null }, fiscalYear: YEAR, rows: [], totalBudgeted: 0, totalExecuted: 0 });
    await settle();

    const setYear = h.component.setYear(YEAR - 1);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/budget-vs-actual` && r.params.get('fiscalYear') === String(YEAR - 1))
      .flush({ estate: { name: 'Sol', cif: null }, fiscalYear: YEAR - 1, rows: [], totalBudgeted: 0, totalExecuted: 0 });
    await setYear;
  });
});
