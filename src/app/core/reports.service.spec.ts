import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let h: ApiServiceHarness<ReportsService>;

  beforeEach(() => {
    h = setupApiService(ReportsService);
  });

  afterEach(() => h.http.verify());

  it('pide sumas y saldos por ejercicio', async () => {
    const p = h.service.trialBalance('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/trial-balance` && r.params.get('fiscalYear') === '2026')
      .flush({ estate: { name: 'Sol', cif: null }, fiscalYear: 2026, rows: [], totalDebit: 0, totalCredit: 0 });
    expect((await p).fiscalYear).toBe(2026);
  });

  it('pide el mayor con cuenta obligatoria y filtros opcionales', async () => {
    const p = h.service.generalLedger('e1', { accountCode: '430', propertyId: 'p1', from: '2026-01-01' });
    h.http.expectOne((r) =>
      r.url === `${API}/estates/e1/reports/general-ledger` &&
      r.params.get('accountCode') === '430' &&
      r.params.get('propertyId') === 'p1' &&
      r.params.get('from') === '2026-01-01' &&
      r.params.get('supplierId') === null,
    ).flush({ estate: { name: 'Sol', cif: null }, account: { code: '430', name: 'Propietarios' }, from: '2026-01-01', to: null, openingBalance: 0, closingBalance: 0, rows: [] });
    expect((await p).account.code).toBe('430');
  });

  it('pide el balance de situación a una fecha', async () => {
    const p = h.service.balanceSheet('e1', '2026-06-30');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/balance-sheet` && r.params.get('asOf') === '2026-06-30')
      .flush({ estate: { name: 'Sol', cif: null }, asOf: '2026-06-30', asset: { rows: [], total: 0 }, liability: { rows: [], total: 0 }, equity: { rows: [], total: 0 }, balanced: true });
    expect((await p).balanced).toBe(true);
  });

  it('pide resultados frente a presupuesto', async () => {
    const p = h.service.budgetVsActual('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/budget-vs-actual` && r.params.get('fiscalYear') === '2026')
      .flush({ estate: { name: 'Sol', cif: null }, fiscalYear: 2026, rows: [], totalBudgeted: 0, totalExecuted: 0 });
    await p;
  });

  it('pide la liquidación por criterio de caja con las fechas obligatorias', async () => {
    const p = h.service.cashSettlement('e1', '2026-01-01', '2026-06-30');
    h.http.expectOne((r) =>
      r.url === `${API}/estates/e1/reports/cash-settlement` && r.params.get('from') === '2026-01-01' && r.params.get('to') === '2026-06-30',
    ).flush({ estate: { name: 'Sol', cif: null }, from: '2026-01-01', to: '2026-06-30', income: { rows: [], total: 0 }, expense: { rows: [], total: 0 }, net: 0 });
    await p;
  });

  it('pide el extracto de una propiedad', async () => {
    const p = h.service.propertyStatement('prop1', { from: '2026-01-01' });
    h.http.expectOne((r) => r.url === `${API}/properties/prop1/ledger-extract` && r.params.get('from') === '2026-01-01')
      .flush({ estate: { name: 'Sol', cif: null }, account: { code: '430', name: 'Propietarios' }, from: '2026-01-01', to: null, openingBalance: 0, closingBalance: 0, rows: [], property: { id: 'prop1', ref: '1A' } });
    expect((await p).property.ref).toBe('1A');
  });

  it('descarga cualquier informe de finca en Excel o PDF', async () => {
    const p = h.service.download('e1', 'trial-balance', 'xlsx', { fiscalYear: 2026 });
    const req = h.http.expectOne(`${API}/estates/e1/reports/trial-balance?format=xlsx&fiscalYear=2026`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect(await p).toBeInstanceOf(Blob);
  });

  it('descarga el extracto de una propiedad en PDF', async () => {
    const p = h.service.downloadPropertyStatement('prop1', 'pdf', { from: '2026-01-01', to: '2026-06-30' });
    const req = h.http.expectOne(`${API}/properties/prop1/ledger-extract?format=pdf&from=2026-01-01&to=2026-06-30`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF']));
    expect(await p).toBeInstanceOf(Blob);
  });
});
