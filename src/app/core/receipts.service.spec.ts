import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { ReceiptsService } from './receipts.service';

describe('ReceiptsService', () => {
  let h: ApiServiceHarness<ReceiptsService>;

  beforeEach(() => {
    h = setupApiService(ReceiptsService);
  });

  afterEach(() => h.http.verify());

  describe('mapReceipt', () => {
    it('listReceiptsForUser (rol C) traduce method, castea fechas y resuelve period/owner/unit con fallback', async () => {
      const promise = h.service.listReceiptsForUser('u1');
      const req = h.http.expectOne(`${API}/users/u1/receipts`);
      req.flush([{
        id: 'r1', no: '2026/03-001', period: { periodKey: '2026-03', label: 'Marzo 2026' },
        property: { ref: '1-2-A' }, ownerNameSnapshot: 'Ana García', amount: '100', status: 'Pendiente',
        method: 'Domiciliacion', date: '2026-03-01T00:00:00.000Z', dueDate: '2026-03-05T00:00:00.000Z',
      }]);
      const [r] = await promise;
      expect(r.periodKey).toBe('2026-03');
      expect(r.period).toBe('Marzo 2026');
      expect(r.unit).toBe('1-2-A');
      expect(r.owner).toBe('Ana García');
      expect(r.method).toBe('Domiciliación');
      expect(r.date).toBe('2026-03-01');
      expect(r.dueDate).toBe('2026-03-05');
    });

    it('period como string plano (no objeto) se conserva tal cual', async () => {
      const promise = h.service.listReceiptsForUser('u1');
      const req = h.http.expectOne(`${API}/users/u1/receipts`);
      req.flush([{ id: 'r1', no: '2026/03-001', period: 'Marzo 2026', amount: '50', status: 'Pagada', method: 'Efectivo', date: '2026-03-01' }]);
      expect((await promise)[0].period).toBe('Marzo 2026');
    });

    it('sin snapshot de titular ni propiedad embebida, owner/unit quedan vacíos, no undefined', async () => {
      const promise = h.service.listReceiptsForUser('u1');
      const req = h.http.expectOne(`${API}/users/u1/receipts`);
      req.flush([{ id: 'r1', no: '2026/03-001', amount: '50', status: 'Pendiente', method: 'Bizum', date: '2026-03-01' }]);
      const [r] = await promise;
      expect(r.owner).toBe('');
      expect(r.unit).toBe('');
      expect(r.periodKey).toBe('');
    });

    it('dueDate ausente se conserva como undefined, no como cadena vacía', async () => {
      const promise = h.service.listReceiptsForUser('u1');
      const req = h.http.expectOne(`${API}/users/u1/receipts`);
      req.flush([{ id: 'r1', no: '2026/03-001', amount: '50', status: 'Pagada', method: 'Efectivo', date: '2026-03-01' }]);
      expect((await promise)[0].dueDate).toBeUndefined();
    });
  });

  describe('listReceiptsByEstate (rol B)', () => {
    it('acepta la respuesta como array plano', async () => {
      const promise = h.service.listReceiptsByEstate('e1');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`);
      expect(req.request.params.get('pageSize')).toBe('200');
      req.flush([{ id: 'r1', no: '1', amount: '100', status: 'Pendiente', method: 'Domiciliacion', date: '2026-01-01' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('acepta la respuesta envuelta en { items }', async () => {
      const promise = h.service.listReceiptsByEstate('e1');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`);
      req.flush({ items: [{ id: 'r1', no: '1', amount: '100', status: 'Pendiente', method: 'Domiciliacion', date: '2026-01-01' }], total: 1 });
      expect((await promise)).toHaveLength(1);
    });

    it('pasa periodKey/status/page/pageSize como filtros', async () => {
      const promise = h.service.listReceiptsByEstate('e1', { periodKey: '2026-03', status: 'Pendiente', page: 2, pageSize: 30 });
      const req = h.http.expectOne((r) =>
        r.url === `${API}/estates/e1/receipts`
        && r.params.get('periodKey') === '2026-03'
        && r.params.get('status') === 'Pendiente'
        && r.params.get('page') === '2'
        && r.params.get('pageSize') === '30');
      req.flush([]);
      await promise;
    });
  });

  describe('listAccountingPeriods — el mapeo periodKey → key (bug real corregido, ver comentario en el servicio)', () => {
    it('mapea el campo periodKey de la API al campo key que espera el frontend', async () => {
      const promise = h.service.listAccountingPeriods('e1');
      const req = h.http.expectOne(`${API}/estates/e1/accounting/periods`);
      req.flush([{ periodKey: '2026-03', label: 'Marzo 2026', monthAbbrev: 'MAR' }]);
      const [period] = await promise;
      expect(period.key).toBe('2026-03');
      expect(period.label).toBe('Marzo 2026');
      expect(period.monthAbbrev).toBe('MAR');
      // Confirma que NO es un passthrough sin transformar (el bug original:
      // el objeto crudo no tenía `key`, solo `periodKey`).
      expect((period as unknown as { periodKey?: unknown }).periodKey).toBeUndefined();
    });
  });

  describe('Generación y alta de recibos', () => {
    it('generateReceipts manda periodKey/label/monthAbbrev', async () => {
      const promise = h.service.generateReceipts('e1', '2026-03', 'Marzo 2026', 'MAR');
      const req = h.http.expectOne(`${API}/estates/e1/receipts/generate`);
      expect(req.request.body).toEqual({ periodKey: '2026-03', label: 'Marzo 2026', monthAbbrev: 'MAR' });
      req.flush({ created: 10, skipped: 0, totalProperties: 10 });
      expect((await promise).created).toBe(10);
    });

    it('createManualReceipt traduce el método de pago hacia la API', async () => {
      const promise = h.service.createManualReceipt('e1', {
        propertyId: 'p1', periodKey: '2026-03', concept: 'Derrama', kind: 'derrama', amount: 200, dueDate: '2026-03-15', method: 'Transferencia',
      });
      const req = h.http.expectOne(`${API}/estates/e1/receipts`);
      expect(req.request.body.method).toBe('Transferencia');
      expect(req.request.body.kind).toBe('derrama');
      req.flush({ id: 'r1', no: '2026/03-M001', amount: '200', outstanding: '200', kind: 'derrama', status: 'Pendiente', method: 'Transferencia', date: '2026-03-01' });
      const created = await promise;
      expect(created.amount).toBe(200);
      expect(created.outstanding).toBe(200);
      // El tipo se muestra en español y el valor del enum queda en kindCode.
      expect(created.kind).toBe('Derrama');
      expect(created.kindCode).toBe('derrama');
    });

    it('cancelReceipt manda el motivo a /cancel', async () => {
      const promise = h.service.cancelReceipt('r1', 'Emitido por error');
      const req = h.http.expectOne(`${API}/receipts/r1/cancel`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ reason: 'Emitido por error' });
      req.flush({ id: 'r1', no: 'X', amount: '10', outstanding: '0', kind: 'cuota_ordinaria', status: 'Anulado', date: '2026-03-01' });
      expect((await promise).status).toBe('Anulado');
    });

    it('updateReceipt traduce el método si viene, y lo omite si no', async () => {
      const withMethod = h.service.updateReceipt('r1', { status: 'Devuelto', method: 'Devolución', returnCode: 'MD01' });
      const req1 = h.http.expectOne(`${API}/receipts/r1`);
      expect(req1.request.body).toEqual({ status: 'Devuelto', method: 'Devolucion', returnCode: 'MD01' });
      req1.flush(null);
      await withMethod;

      const withoutMethod = h.service.updateReceipt('r1', { status: 'Pagada' });
      const req2 = h.http.expectOne(`${API}/receipts/r1`);
      expect(req2.request.body).toEqual({ status: 'Pagada', method: undefined });
      req2.flush(null);
      await withoutMethod;
    });

    it('uploadPaymentProof sube multipart y devuelve el recibo mapeado', async () => {
      const file = new File(['x'], 'justificante.pdf');
      const promise = h.service.uploadPaymentProof('r1', file);
      const req = h.http.expectOne(`${API}/receipts/r1/payment-proof`);
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush({ id: 'r1', no: '1', amount: '100', status: 'Pagada', method: 'Transferencia', date: '2026-03-01' });
      expect((await promise).status).toBe('Pagada');
    });

    it('downloadPaymentProof pide un blob', async () => {
      const promise = h.service.downloadPaymentProof('r1');
      const req = h.http.expectOne(`${API}/receipts/r1/payment-proof/file`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(await promise).toBeInstanceOf(Blob);
    });
  });
});
