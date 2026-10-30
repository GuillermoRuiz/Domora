import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { PayrollService, TaxService } from './tax.service';

describe('TaxService', () => {
  let h: ApiServiceHarness<TaxService>;

  beforeEach(() => {
    h = setupApiService(TaxService);
  });

  afterEach(() => h.http.verify());

  it('pide los modelos con año y trimestre', async () => {
    const m111 = h.service.model111('e1', 2026, 2);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/111` && r.params.get('year') === '2026' && r.params.get('quarter') === '2').flush({ boxes: {} });
    await m111;
    const m190 = h.service.model190('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/190` && r.params.get('year') === '2026').flush({ rows: [] });
    await m190;
    const m347 = h.service.model347('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/347`).flush({ purchases: [] });
    await m347;
  });

  it('descarga el Excel o el PDF del modelo', async () => {
    const promise = h.service.download('e1', '111', 'pdf', 2026, 1);
    const req = h.http.expectOne(`${API}/estates/e1/tax/111?year=2026&format=pdf&quarter=1`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF']));
    expect(await promise).toBeInstanceOf(Blob);
  });

  it('ingresos: lista, alta y deshacer', async () => {
    const list = h.service.listSettlements('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax-settlements` && r.params.get('year') === '2026')
      .flush([{ id: 't1', kind: 'modelo111', period: '2026-T1', date: '2026-04-15T00:00:00.000Z', amount: '220.75' }]);
    expect((await list)[0]).toMatchObject({ date: '2026-04-15', amount: 220.75 });

    const create = h.service.createSettlement('e1', { kind: 'modelo111', period: '2026-T1', date: '2026-04-15', amount: 220.75, reference: 'NRC' });
    const c = h.http.expectOne(`${API}/estates/e1/tax-settlements`);
    expect(c.request.body).toEqual({ kind: 'modelo111', period: '2026-T1', date: '2026-04-15', amount: 220.75, reference: 'NRC' });
    c.flush({});
    await create;

    const undo = h.service.undoSettlement('t1', 'Error');
    h.http.expectOne(`${API}/tax-settlements/t1/undo`).flush({});
    await undo;
  });
});

describe('PayrollService', () => {
  let h: ApiServiceHarness<PayrollService>;

  beforeEach(() => {
    h = setupApiService(PayrollService);
  });

  afterEach(() => h.http.verify());

  it('lista, registra, paga, deshace y anula', async () => {
    const raw = { id: 'p1', accrualDate: '2026-02-28T00:00:00.000Z', paidDate: null, grossSalary: 1500 };
    const list = h.service.list('e1', 2026);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/payroll` && r.params.get('year') === '2026').flush([raw]);
    expect((await list)[0].accrualDate).toBe('2026-02-28');

    const create = h.service.create('e1', { staffMemberId: 's1', period: '2026-02', grossSalary: 1500, employeeSs: 97.5, employerSs: 480, irpfWithholding: 150 });
    h.http.expectOne(`${API}/estates/e1/payroll`).flush(raw);
    await create;

    const pay = h.service.pay('p1', { date: '2026-03-01', method: 'Transferencia', bankAccountId: 'b1' });
    const p = h.http.expectOne(`${API}/payroll/p1/pay`);
    expect(p.request.body).toEqual({ date: '2026-03-01', method: 'Transferencia', bankAccountId: 'b1' });
    p.flush({ ...raw, paidDate: '2026-03-01T00:00:00.000Z', status: 'Pagada' });
    expect((await pay).paidDate).toBe('2026-03-01');

    const undo = h.service.undoPayment('p1', 'Error');
    h.http.expectOne(`${API}/payroll/p1/undo-payment`).flush(raw);
    await undo;
    const cancel = h.service.cancel('p1', 'Error');
    h.http.expectOne(`${API}/payroll/p1/cancel`).flush(raw);
    await cancel;
  });
});
