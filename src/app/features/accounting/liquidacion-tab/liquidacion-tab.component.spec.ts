import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { LiquidacionTabComponent } from './liquidacion-tab.component';

describe('LiquidacionTabComponent', () => {
  let h: ComponentHarness<LiquidacionTabComponent>;

  beforeEach(() => {
    h = setupComponent(LiquidacionTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  it('muestra cobrado, pagado y el resultado de caja', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/cash-settlement`).flush({
      estate: { name: 'Sol', cif: null },
      from: h.component.from(), to: h.component.to(),
      income: { rows: [{ code: '700', name: 'Cuotas', amount: 700 }], total: 700 },
      expense: { rows: [{ code: '622', name: 'Mantenimiento', amount: 500 }], total: 500 },
      net: 200,
    });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cuotas');
    expect(h.el.textContent).toContain('Mantenimiento');
    expect(h.el.textContent).toContain('200,00 €');
  });

  it('cambiar las fechas vuelve a pedir la liquidación', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/cash-settlement`).flush({
      estate: { name: 'Sol', cif: null }, from: h.component.from(), to: h.component.to(),
      income: { rows: [], total: 0 }, expense: { rows: [], total: 0 }, net: 0,
    });
    await settle();

    const setFrom = h.component.setFrom('2026-03-01');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/cash-settlement` && r.params.get('from') === '2026-03-01')
      .flush({ estate: { name: 'Sol', cif: null }, from: '2026-03-01', to: h.component.to(), income: { rows: [], total: 0 }, expense: { rows: [], total: 0 }, net: 0 });
    await setFrom;
  });
});
