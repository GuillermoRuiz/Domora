import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { CollectionsService } from './collections.service';

describe('CollectionsService', () => {
  let h: ApiServiceHarness<CollectionsService>;

  beforeEach(() => {
    h = setupApiService(CollectionsService);
  });

  afterEach(() => h.http.verify());

  it('registerCollection traduce el método al enum del backend', async () => {
    const promise = h.service.registerCollection('e1', {
      propertyId: 'p1', date: '2026-03-10', amount: 40, method: 'Pago en oficina', receiptIds: ['r1'],
    });
    const req = h.http.expectOne(`${API}/estates/e1/collections`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      propertyId: 'p1', date: '2026-03-10', amount: 40, method: 'PagoEnOficina', receiptIds: ['r1'],
    });
    req.flush({});
    await promise;
  });

  it('undoCollection y returnCollection', async () => {
    const undo = h.service.undoCollection('c1', 'Duplicado');
    const u = h.http.expectOne(`${API}/collections/c1/undo`);
    expect(u.request.body).toEqual({ reason: 'Duplicado' });
    u.flush({});
    await undo;

    const ret = h.service.returnCollection('c1', { date: '2026-03-12', returnCode: 'AM04', feeAmount: 3.5, rechargeFee: true });
    const r = h.http.expectOne(`${API}/collections/c1/return`);
    expect(r.request.body).toEqual({ date: '2026-03-12', returnCode: 'AM04', feeAmount: 3.5, rechargeFee: true });
    r.flush({});
    await ret;
  });

  it('receiptHistory recorta fechas y traduce el método', async () => {
    const promise = h.service.receiptHistory('r1');
    h.http.expectOne(`${API}/receipts/r1/history`).flush({
      receiptId: 'r1', no: '2026/03-001', amount: 100, outstanding: 0, status: 'Pagada',
      movements: [
        { date: '2026-03-01T00:00:00.000Z', sourceType: 'receipt_issue', debit: 100, credit: 0, balance: 100, method: null },
        { date: '2026-03-10T00:00:00.000Z', sourceType: 'collection', debit: 0, credit: 100, balance: 0, method: 'PagoEnOficina', collectionId: 'c1', collectionActive: true },
      ],
    });
    const history = await promise;
    expect(history.movements[0].date).toBe('2026-03-01');
    expect(history.movements[1].method).toBe('Pago en oficina');
    expect(history.movements[1].fromRemesa).toBe(false);
  });

  it('propertyAccount, applyAdvance y los ingresos sin identificar', async () => {
    const account = h.service.propertyAccount('e1', 'p1');
    h.http.expectOne(`${API}/estates/e1/property-accounts/p1`).flush({
      propertyId: 'p1', pending: 100, advance: 25, balance: 75,
      openReceipts: [{ id: 'r1', dueDate: '2026-03-05T00:00:00.000Z' }],
    });
    expect((await account).openReceipts[0].dueDate).toBe('2026-03-05');

    const apply = h.service.applyAdvance('e1', 'p1');
    const a = h.http.expectOne(`${API}/estates/e1/advances/apply`);
    expect(a.request.body).toEqual({ propertyId: 'p1', receiptIds: undefined });
    a.flush({ applied: 25 });
    expect((await apply).applied).toBe(25);

    const list = h.service.listSuspense('e1');
    h.http.expectOne(`${API}/estates/e1/suspense`).flush([
      { id: 's1', date: '2026-02-05T00:00:00.000Z', amount: 150, remaining: 50, applications: [{ id: 'c1', date: '2026-02-08T00:00:00.000Z', amount: 100 }] },
    ]);
    const [item] = await list;
    expect(item.date).toBe('2026-02-05');
    expect(item.applications[0].date).toBe('2026-02-08');

    const register = h.service.registerSuspense('e1', { date: '2026-02-05', amount: 150, concept: 'Sin referencia' });
    h.http.expectOne(`${API}/estates/e1/suspense`).flush({});
    await register;

    const applyS = h.service.applySuspense('s1', { propertyId: 'p1', amount: 50 });
    const s = h.http.expectOne(`${API}/suspense/s1/apply`);
    expect(s.request.body).toEqual({ propertyId: 'p1', amount: 50 });
    s.flush({});
    await applyS;
  });
});
