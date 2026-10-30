import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { BudgetService } from './budget.service';

describe('BudgetService', () => {
  let h: ApiServiceHarness<BudgetService>;

  beforeEach(() => {
    h = setupApiService(BudgetService);
  });

  afterEach(() => h.http.verify());

  describe('Presupuesto (por cuenta contable)', () => {
    it('listBudget mapea id/accountId/accountCode/category/fiscalYear/budgeted/executed tal cual el contrato real de la API', async () => {
      const promise = h.service.listBudget('e1', 2026);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/budget` && r.params.get('fiscalYear') === '2026');
      req.flush([{ id: 'bi1', accountId: 'ca1', accountCode: '628', category: 'Suminis.', fiscalYear: 2026, budgeted: '1000', executed: '350' }]);
      const [item] = await promise;
      expect(item.id).toBe('bi1');
      expect(item.accountId).toBe('ca1');
      expect(item.code).toBe('628');
      expect(item.category).toBe('Suminis.');
      expect(item.budgeted).toBe(1000);
      expect(item.executed).toBe(350);
    });

    it('upsertBudgetItem manda el item tal cual', async () => {
      const item = { accountCode: '628', category: 'Suministros', fiscalYear: 2026, budgeted: 1000 };
      const promise = h.service.upsertBudgetItem('e1', item);
      const req = h.http.expectOne(`${API}/estates/e1/budget`);
      expect(req.request.body).toEqual(item);
      req.flush(null);
      await promise;
    });
  });

  describe('Presupuesto (por centro de coste)', () => {
    it('listCostCentreBudget mapea costCentreId/costCentreName/budgeted/executed', async () => {
      const promise = h.service.listCostCentreBudget('e1', 2026);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centre-budget` && r.params.get('fiscalYear') === '2026');
      req.flush([{ id: 'ccb1', costCentreId: 'cc1', costCentreName: 'Piscina', fiscalYear: 2026, budgeted: '500', executed: '300' }]);
      const [item] = await promise;
      expect(item.costCentreId).toBe('cc1');
      expect(item.costCentreName).toBe('Piscina');
      expect(item.budgeted).toBe(500);
      expect(item.executed).toBe(300);
    });

    it('upsertCostCentreBudget manda el item tal cual', async () => {
      const item = { costCentreId: 'cc1', fiscalYear: 2026, budgeted: 500 };
      const promise = h.service.upsertCostCentreBudget('e1', item);
      const req = h.http.expectOne(`${API}/estates/e1/cost-centre-budget`);
      expect(req.request.body).toEqual(item);
      req.flush(null);
      await promise;
    });
  });

  describe('getAnalysis', () => {
    it('mapea budget/costCentreBudget/reserveLegalMinimum, incluido executedPriorYear', async () => {
      const promise = h.service.getAnalysis('e1', 2026);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/budget/analysis` && r.params.get('fiscalYear') === '2026');
      req.flush({
        fiscalYear: 2026,
        budget: [{ id: 'bi1', accountId: 'ca1', accountCode: '628', category: 'Suministros', fiscalYear: 2026, budgeted: '1000', executed: '800', executedPriorYear: '600' }],
        costCentreBudget: [{ id: 'ccb1', costCentreId: 'cc1', costCentreName: 'Piscina', fiscalYear: 2026, budgeted: '500', executed: '500', executedPriorYear: '250' }],
        reserveLegalMinimum: '100',
      });
      const result = await promise;
      expect(result.budget[0].executedPriorYear).toBe(600);
      expect(result.costCentreBudget[0].executedPriorYear).toBe(250);
      expect(result.reserveLegalMinimum).toBe(100);
    });

    it('reserveLegalMinimum null se mantiene null (sin presupuesto cargado)', async () => {
      const promise = h.service.getAnalysis('e1', 2026);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/budget/analysis`);
      req.flush({ fiscalYear: 2026, budget: [], costCentreBudget: [], reserveLegalMinimum: null });
      const result = await promise;
      expect(result.reserveLegalMinimum).toBeNull();
    });
  });
});
