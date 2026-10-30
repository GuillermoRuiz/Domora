import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { AnalisisTabComponent } from './analisis-tab.component';
import type { AccountingEstate, FiscalYear } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 1000, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
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

function makeAnalysisResponse(overrides: Partial<any> = {}) {
  return {
    fiscalYear,
    budget: [
      { id: 'bi1', accountId: 'ca1', accountCode: '628', category: 'Suministros', fiscalYear, budgeted: 1000, executed: 800, executedPriorYear: 600 },
    ],
    costCentreBudget: [
      { id: 'ccb1', costCentreId: 'cc1', costCentreName: 'Piscina', fiscalYear, budgeted: 500, executed: 500, executedPriorYear: 250 },
    ],
    reserveLegalMinimum: 100,
    ...overrides,
  };
}

describe('AnalisisTabComponent', () => {
  let h: ComponentHarness<AnalisisTabComponent>;

  beforeEach(() => {
    h = setupComponent(AnalisisTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function flushInitialLoad(analysis: any = makeAnalysisResponse(), fiscalYears: FiscalYear[] = [makeFiscalYear()]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years`).flush(fiscalYears);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/budget/analysis`).flush(analysis);
    await settle();
    h.fixture.detectChanges();
  }

  it('muestra el fondo de reserva actual y el mínimo legal, con cumplimiento cuando corresponde', async () => {
    await flushInitialLoad(makeAnalysisResponse({ reserveLegalMinimum: 100 }));

    expect(h.el.textContent).toContain('Cumple el mínimo legal');
  });

  it('marca incumplimiento cuando la reserva actual está por debajo del mínimo legal', async () => {
    h.component.estate = makeEstate({ reserve: 50 });
    await flushInitialLoad(makeAnalysisResponse({ reserveLegalMinimum: 100 }));

    expect(h.el.textContent).toContain('Por debajo del mínimo legal');
  });

  it('sin presupuesto cargado, no afirma cumplimiento (reserveLegalMinimum null)', async () => {
    await flushInitialLoad(makeAnalysisResponse({ reserveLegalMinimum: null }));

    expect(h.el.textContent).toContain('Sin presupuesto cargado para evaluar');
  });

  it('calcula la variación porcentual del ejecutado por cuenta respecto al año anterior', async () => {
    await flushInitialLoad(makeAnalysisResponse());

    // 800 vs 600 el año anterior → +33%
    expect(h.component.varianceDisplay(800, 600)?.pct).toBe(33);
    expect(h.el.textContent).toContain('+33%');
  });

  it('sin ejecución el año anterior, muestra "—" en vez de una variación falsa', async () => {
    await flushInitialLoad(makeAnalysisResponse({
      budget: [{ id: 'bi1', accountId: 'ca1', accountCode: '628', category: 'Suministros', fiscalYear, budgeted: 1000, executed: 800, executedPriorYear: 0 }],
    }));

    expect(h.component.varianceDisplay(800, 0)).toBeNull();
  });

  it('cambiar el selector de ejercicio recarga el análisis para el nuevo año', async () => {
    await flushInitialLoad(makeAnalysisResponse(), [makeFiscalYear(), makeFiscalYear({ year: fiscalYear - 1 })]);

    const promise = h.component.onFiscalYearChange(fiscalYear - 1);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/budget/analysis` && r.params.get('fiscalYear') === String(fiscalYear - 1))
      .flush(makeAnalysisResponse({ fiscalYear: fiscalYear - 1 }));
    await promise;
    h.fixture.detectChanges();

    expect(h.component.fiscalYear()).toBe(fiscalYear - 1);
  });
});
