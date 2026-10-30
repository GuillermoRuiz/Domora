import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { BalanceTabComponent } from './balance-tab.component';

const YEAR = new Date().getFullYear();

describe('BalanceTabComponent', () => {
  let h: ComponentHarness<BalanceTabComponent>;

  beforeEach(() => {
    h = setupComponent(BalanceTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  it('arranca en sumas y saldos del ejercicio actual', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/trial-balance` && r.params.get('fiscalYear') === String(YEAR))
      .flush({
        estate: { name: 'Sol', cif: null }, fiscalYear: YEAR,
        rows: [{ code: '572', name: 'Bancos', debit: 400, credit: 0, balance: 400 }],
        totalDebit: 400, totalCredit: 400,
      });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Bancos');
    expect(h.el.textContent).toContain('400,00 €');
  });

  it('cambia a balance de situación y avisa si no cuadra', async () => {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/trial-balance`)
      .flush({ estate: { name: 'Sol', cif: null }, fiscalYear: YEAR, rows: [], totalDebit: 0, totalCredit: 0 });
    await settle();

    const select = h.component.select('balance-sheet');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/balance-sheet`).flush({
      estate: { name: 'Sol', cif: null }, asOf: '2026-06-30',
      asset: { rows: [{ code: '572', name: 'Bancos', amount: 100 }], total: 100 },
      liability: { rows: [], total: 0 },
      equity: { rows: [], total: 0 },
      balanced: false,
    });
    await select;
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('no cuadra');
    expect(h.el.textContent).toContain('Total activo');
  });
});
