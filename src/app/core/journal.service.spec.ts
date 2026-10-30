import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { JournalService, ReconciliationService } from './journal.service';

describe('JournalService', () => {
  let h: ApiServiceHarness<JournalService>;

  beforeEach(() => {
    h = setupApiService(JournalService);
  });

  afterEach(() => h.http.verify());

  it('list manda solo los filtros con valor y normaliza fechas e importes', async () => {
    const promise = h.service.list('e1', { from: '2026-01-01', to: '', sourceType: 'manual', q: '  luz ', page: 2, pageSize: 50 });
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/journal`);
    expect(req.request.params.get('from')).toBe('2026-01-01');
    expect(req.request.params.has('to')).toBe(false);
    expect(req.request.params.get('sourceType')).toBe('manual');
    expect(req.request.params.get('q')).toBe('luz');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({
      total: 1, page: 2, pageSize: 50,
      items: [{
        id: 'j1', date: '2026-03-01T00:00:00.000Z', total: '12.5', concept: 'Luz',
        lines: [{ lineNo: 1, debit: '12.5', credit: '0' }, { lineNo: 2, debit: '0', credit: '12.5' }],
      }],
    });
    const page = await promise;
    expect(page.total).toBe(1);
    expect(page.items[0].date).toBe('2026-03-01');
    expect(page.items[0].total).toBe(12.5);
    expect(page.items[0].attachments).toEqual([]);
    expect(page.items[0].lines[1].credit).toBe(12.5);
  });

  it('createManual manda el asiento en euros a la finca', async () => {
    const input = { date: '2026-03-01', concept: 'Ajuste', lines: [{ accountId: 'a', debit: 10, credit: 0 }, { accountId: 'b', debit: 0, credit: 10 }] };
    const promise = h.service.createManual('e1', input);
    const req = h.http.expectOne(`${API}/estates/e1/journal`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'j9', date: '2026-03-01', total: 10, lines: [] });
    expect((await promise).id).toBe('j9');
  });

  it('reverse manda el motivo y, si la hay, la fecha', async () => {
    const promise = h.service.reverse('j1', 'Error de cuenta', '2026-04-01');
    const req = h.http.expectOne(`${API}/journal/j1/reverse`);
    expect(req.request.body).toEqual({ reason: 'Error de cuenta', date: '2026-04-01' });
    req.flush({});
    await promise;
  });

  it('quickEntry y transfer van a la tesorería de la finca', async () => {
    const quick = h.service.quickEntry('e1', { date: '2026-03-01', direction: 'out', amount: 5, counterpartAccountId: 'a626', concept: 'Comisión' });
    h.http.expectOne(`${API}/estates/e1/treasury/entries`).flush({});
    await quick;
    const transfer = h.service.transfer('e1', { date: '2026-03-01', amount: 100, fromBankAccountId: 'b1' });
    const req = h.http.expectOne(`${API}/estates/e1/treasury/transfers`);
    expect(req.request.body).toEqual({ date: '2026-03-01', amount: 100, fromBankAccountId: 'b1' });
    req.flush({});
    await transfer;
  });

  it('attach sube el justificante como multipart', async () => {
    const promise = h.service.attach('j1', new File(['x'], 'factura.pdf', { type: 'application/pdf' }));
    const req = h.http.expectOne(`${API}/journal/j1/attachments`);
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush({});
    await promise;
  });
});

describe('ReconciliationService', () => {
  let h: ApiServiceHarness<ReconciliationService>;
  const BASE = `${API}/estates/e1/bank-accounts/b1`;

  beforeEach(() => {
    h = setupApiService(ReconciliationService);
  });

  afterEach(() => h.http.verify());

  it('ledger pasa importes y saldos a número', async () => {
    const promise = h.service.ledger('e1', 'b1');
    h.http.expectOne((r) => r.url === `${BASE}/ledger`).flush({
      bankAccountId: 'b1', alias: 'Principal', openingBalance: '0', closingBalance: '90.5',
      lines: [{ id: 'l1', date: '2026-03-01', amount: '-9.5', balance: '90.5', reconciliationGroupId: null }],
    });
    const ledger = await promise;
    expect(ledger.closingBalance).toBe(90.5);
    expect(ledger.lines[0].amount).toBe(-9.5);
  });

  it('statement con pending pide solo lo pendiente; sin extracto, lastStatement es null', async () => {
    const promise = h.service.statement('e1', 'b1', true);
    const req = h.http.expectOne((r) => r.url === `${BASE}/statement`);
    expect(req.request.params.get('pending')).toBe('true');
    req.flush({ entries: [{ id: 's1', date: '2026-03-01', amount: '-9.50' }], lastStatement: null });
    const view = await promise;
    expect(view.entries[0].amount).toBe(-9.5);
    expect(view.lastStatement).toBeNull();
  });

  it('match manda las partidas y los apuntes; unmatch borra el grupo', async () => {
    const match = h.service.match('e1', 'b1', ['s1'], ['l1', 'l2']);
    const req = h.http.expectOne(`${BASE}/reconciliations`);
    expect(req.request.body).toEqual({ entryIds: ['s1'], lineIds: ['l1', 'l2'] });
    req.flush({ groupId: 'g1' });
    await match;

    const unmatch = h.service.unmatch('g1');
    const del = h.http.expectOne(`${API}/reconciliations/g1`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ unmatched: true });
    await unmatch;
  });

  it('autoMatch devuelve el resumen del backend', async () => {
    const promise = h.service.autoMatch('e1', 'b1');
    h.http.expectOne(`${BASE}/reconciliations/auto`).flush({ matched: 2, pendingEntries: 1, pendingLines: 0 });
    expect(await promise).toEqual({ matched: 2, pendingEntries: 1, pendingLines: 0 });
  });
});
