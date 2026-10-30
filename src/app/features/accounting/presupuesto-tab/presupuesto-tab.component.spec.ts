import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { PresupuestoTabComponent } from './presupuesto-tab.component';
import type { AccountingEstate, ChartAccount, FiscalYear } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

/** Forma REAL del contrato de la API (`accountCode` top-level, no `code`) — ver budget.service.ts (backend) `listBudget`. Usar SIEMPRE esta forma en `.flush()`, nunca el tipo `BudgetItem` del frontend (ya post-mapeado). */
function makeBudgetItem(overrides: Partial<{
  id: string; accountId: string; accountCode: string; category: string; fiscalYear: number; budgeted: number; executed: number;
}> = {}) {
  return {
    id: 'bi1', accountId: 'ca1', accountCode: '628', category: 'Suministros', fiscalYear,
    budgeted: 500, executed: 300, ...overrides,
  };
}

function makeAccount(overrides: Partial<ChartAccount> = {}): ChartAccount {
  return { id: 'ca1', estateId: 'e1', code: '628', name: 'Suministros', shortName: 'Suministros', ...overrides };
}

function makeFiscalYear(overrides: Partial<FiscalYear> = {}): FiscalYear {
  return {
    id: null, estateId: 'e1', year: fiscalYear,
    startDate: `${fiscalYear}-01-01`, endDate: `${fiscalYear}-12-31`,
    status: 'Abierto', approvedAt: null, approvedNote: null, closedAt: null,
    ...overrides,
  };
}

const fiscalYear = new Date().getFullYear();

describe('PresupuestoTabComponent', () => {
  let h: ComponentHarness<PresupuestoTabComponent>;

  beforeEach(() => {
    h = setupComponent(PresupuestoTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function flushInitialLoad(budget: unknown[], fiscalYears: FiscalYear[] = [makeFiscalYear()]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years`).flush(fiscalYears);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/budget`).flush(budget);
  }

  it('carga el presupuesto del año fiscal actual y refleja los totales', async () => {
    await flushInitialLoad([
      makeBudgetItem({ accountCode: '628', budgeted: 500, executed: 300 }),
      makeBudgetItem({ accountCode: '700', budgeted: 1000, executed: 200 }),
    ]);
    await settle();
    h.fixture.detectChanges();

    expect(h.component.totalBudgeted()).toBe(1500);
    expect(h.component.totalExecuted()).toBe(500);
    expect(h.el.querySelectorAll('.exec-item')).toHaveLength(2);
  });

  it('el porcentaje de ejecución por partida se calcula sobre lo presupuestado, no sobre el total', () => {
    expect(h.component.pct({ budgeted: 500, executed: 250 })).toBe(50);
    expect(h.component.pct({ budgeted: 0, executed: 100 })).toBe(0); // sin presupuesto, no divide por cero
  });

  it('muestra "Pendiente de aprobación" cuando el ejercicio no tiene approvedAt', async () => {
    await flushInitialLoad([], [makeFiscalYear({ approvedAt: null })]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Pendiente de aprobación');
  });

  it('cambiar el selector de ejercicio recarga el presupuesto para el nuevo año', async () => {
    await flushInitialLoad([makeBudgetItem({ fiscalYear })], [makeFiscalYear(), makeFiscalYear({ year: fiscalYear - 1 })]);
    await settle();
    h.fixture.detectChanges();

    const promise = h.component.onFiscalYearChange(fiscalYear - 1);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/budget` && r.params.get('fiscalYear') === String(fiscalYear - 1))
      .flush([makeBudgetItem({ fiscalYear: fiscalYear - 1, budgeted: 200, executed: 50 })]);
    await promise;
    h.fixture.detectChanges();

    expect(h.component.fiscalYear()).toBe(fiscalYear - 1);
    expect(h.component.totalBudgeted()).toBe(200);
  });

  // El cierre real (regularización, dotación, cierre por dimensión y
  // apertura de N+1) vive en CierreTabComponent — ver cierre-tab.component.spec.ts.
  describe('aprobar el ejercicio', () => {
    it('submitApprove llama al endpoint de aprobación y refleja el nuevo estado', async () => {
      await flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      h.component.openApproveModal();
      h.component.approveNote.set('Aprobado en junta');
      const promise = h.component.submitApprove();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${fiscalYear}/approve` && r.method === 'POST');
      expect(req.request.body).toEqual({ approvedNote: 'Aprobado en junta' });
      req.flush(makeFiscalYear({ approvedAt: '2026-03-15T00:00:00Z', approvedNote: 'Aprobado en junta' }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showApproveModal()).toBe(false);
      expect(h.el.textContent).toContain('Aprobado el');
    });
  });

  describe('modal "Editar presupuesto"', () => {
    it('carga el plan contable la primera vez que se abre', async () => {
      await flushInitialLoad([makeBudgetItem({ accountCode: '628' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openEditModal();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts`).flush([makeAccount({ code: '628' }), makeAccount({ code: '700', name: 'Cuotas' })]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.modal-backdrop')).not.toBeNull();
      // 628 ya está presupuestada — solo 700 queda disponible para añadir.
      expect(h.component.availableAccountsToAdd().map((a) => a.code)).toEqual(['700']);
    });

    it('no vuelve a pedir el plan contable si ya se cargó una vez', async () => {
      await flushInitialLoad([makeBudgetItem({ accountCode: '628' })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openEditModal();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts`).flush([makeAccount({ code: '628' })]);
      await settle();
      h.component.closeEditModal();

      h.component.openEditModal();
      await settle();

      h.http.expectNone((r) => r.url === `${API}/estates/e1/chart-accounts`);
    });

    it('guardar manda un upsert por cada fila y recarga el presupuesto', async () => {
      await flushInitialLoad([makeBudgetItem({ accountCode: '628', budgeted: 500 })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openEditModal();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts`).flush([makeAccount({ code: '628' })]);
      await settle();

      h.component.updateRowBudget('628', '600');

      const savePromise = h.component.saveEditModal();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/budget` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ accountCode: '628', budgeted: 600, fiscalYear });
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/budget`).flush([makeBudgetItem({ accountCode: '628', budgeted: 600, executed: 300 })]);
      await savePromise;
      h.fixture.detectChanges();

      expect(h.component.showEditModal()).toBe(false);
      expect(h.component.totalBudgeted()).toBe(600);
      expect(h.el.querySelector('.toast')?.textContent).toContain('actualizado correctamente');
    });

    it('añadir una partida del plan contable la incorpora a las filas editables con importe 0', async () => {
      await flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();
      h.component.openEditModal();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts`).flush([makeAccount({ code: '628', shortName: 'Suministros' })]);
      await settle();

      h.component.newAccountCode.set('628');
      h.component.addRow();

      expect(h.component.editRows()).toEqual([{ accountCode: '628', category: 'Suministros', budgeted: 0 }]);
      expect(h.component.newAccountCode()).toBe('');
    });
  });
});
