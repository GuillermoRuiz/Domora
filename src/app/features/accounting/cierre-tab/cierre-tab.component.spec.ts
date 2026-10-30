import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { CierreTabComponent } from './cierre-tab.component';
import type { AccountingEstate, ClosePreconditionsView, FiscalYear } from '../../../core/models';

const year = new Date().getFullYear();

function makeEstate(): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
  };
}

function makeFiscalYear(overrides: Partial<FiscalYear> = {}): FiscalYear {
  return {
    id: 'fy1', estateId: 'e1', year,
    startDate: `${year}-01-01`, endDate: `${year}-12-31`,
    status: 'Abierto', approvedAt: null, approvedNote: null, closedAt: null,
    reserveMode: 'receipt_share',
    ...overrides,
  };
}

function makePreconditions(overrides: Partial<ClosePreconditionsView> = {}): ClosePreconditionsView {
  return { year, blockers: [], warnings: [], canClose: true, ...overrides };
}

describe('CierreTabComponent', () => {
  let h: ComponentHarness<CierreTabComponent>;

  beforeEach(() => {
    h = setupComponent(CierreTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function mount(opts: { fiscalYears?: FiscalYear[]; preconditions?: ClosePreconditionsView } = {}): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/fiscal-years`).flush(opts.fiscalYears ?? [makeFiscalYear()]);
    await settle();
    h.http.expectOne(`${API}/estates/e1/fiscal-years/${year}/close-preconditions`).flush(opts.preconditions ?? makePreconditions());
    await settle();
    h.fixture.detectChanges();
  }

  it('sin bloqueos, muestra "todo listo" y el botón de cerrar queda habilitado', async () => {
    await mount();
    expect(h.el.textContent).toContain('Todo listo para cerrar');
    expect(h.component.preconditions()?.canClose).toBe(true);
  });

  it('con bloqueos, los muestra y el cierre queda deshabilitado', async () => {
    await mount({
      preconditions: makePreconditions({
        canClose: false,
        blockers: [{ code: 'previous_year_open', message: `El ejercicio ${year - 1} sigue abierto: ciérralo primero.` }],
      }),
    });
    expect(h.el.textContent).toContain('sigue abierto');
    expect(h.component.preconditions()?.canClose).toBe(false);
    const closeBtn = h.el.querySelector<HTMLButtonElement>('.card--spaced .btn--primary');
    expect(closeBtn?.disabled).toBe(true);
  });

  it('cerrar el ejercicio llama al endpoint y refleja el nuevo estado', async () => {
    await mount();
    h.component.openCloseConfirm();
    h.fixture.detectChanges();
    const promise = h.component.confirmClose();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${year}/close` && r.method === 'POST');
    req.flush(makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` }));
    await settle();
    h.http.expectOne(`${API}/estates/e1/fiscal-years/${year}/close-preconditions`).flush(makePreconditions());
    await promise;
    h.fixture.detectChanges();

    expect(h.component.showCloseConfirm()).toBe(false);
    expect(h.component.currentFiscalYear()?.status).toBe('Cerrado');
    expect(h.el.querySelector('.toast')?.textContent).toContain('cerrado');
  });

  it('un año cerrado ofrece reabrir y aplicar resultado en vez del checklist', async () => {
    await mount({ fiscalYears: [makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` })] });
    expect(h.el.textContent).toContain('Reabrir ejercicio');
    expect(h.el.textContent).toContain('Aplicar resultado');
    expect(h.el.textContent).not.toContain('Todo listo para cerrar');
  });

  it('reabrir con un motivo demasiado corto no llama al backend', async () => {
    await mount({ fiscalYears: [makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` })] });
    h.component.openReopenModal();
    h.component.reopenReason.set('corto');
    await h.component.submitReopen();
    h.fixture.detectChanges();
    expect(h.component.reopenError()).toContain('mínimo 10');
  });

  it('reabrir con un motivo válido llama al endpoint y refleja el nuevo estado', async () => {
    await mount({ fiscalYears: [makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` })] });
    h.component.openReopenModal();
    h.component.reopenReason.set('Se detectó un recibo mal emitido, hay que corregirlo.');
    const promise = h.component.submitReopen();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${year}/reopen` && r.method === 'POST');
    expect(req.request.body).toEqual({ reason: 'Se detectó un recibo mal emitido, hay que corregirlo.' });
    req.flush(makeFiscalYear({ status: 'Abierto', reopenedAt: `${year}-12-31T12:00:00Z`, reopenReason: req.request.body.reason }));
    await settle();
    h.http.expectOne(`${API}/estates/e1/fiscal-years/${year}/close-preconditions`).flush(makePreconditions());
    await promise;
    h.fixture.detectChanges();

    expect(h.component.showReopenModal()).toBe(false);
    expect(h.component.currentFiscalYear()?.status).toBe('Abierto');
    expect(h.el.querySelector('.toast')?.textContent).toContain('reabierto');
  });

  it('aplicar el resultado llama al endpoint con el destino elegido y muestra el importe', async () => {
    await mount({ fiscalYears: [makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` })] });
    h.component.openApplyModal();
    h.component.applyTarget.set('reserve_fund');
    const promise = h.component.submitApply();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${year}/apply-result` && r.method === 'POST');
    expect(req.request.body).toEqual({ target: 'reserve_fund' });
    req.flush({ entryId: 'je1', appliedAmount: 800, target: 'reserve_fund' });
    await promise;
    h.fixture.detectChanges();

    expect(h.component.showApplyModal()).toBe(false);
    expect(h.el.querySelector('.toast')?.textContent).toContain('800');
    expect(h.el.querySelector('.toast')?.textContent).toContain('Fondo de reserva');
  });

  it('si no queda resultado pendiente, muestra el error del backend en el modal', async () => {
    await mount({ fiscalYears: [makeFiscalYear({ status: 'Cerrado', closedAt: `${year}-12-31T10:00:00Z` })] });
    h.component.openApplyModal();
    const promise = h.component.submitApply();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${year}/apply-result` && r.method === 'POST');
    req.flush({ message: 'No queda ningún resultado pendiente de aplicar.' }, { status: 422, statusText: 'Unprocessable Entity' });
    await promise;
    h.fixture.detectChanges();

    expect(h.component.showApplyModal()).toBe(true);
    expect(h.component.applyError()).toContain('No queda ningún resultado');
  });
});
