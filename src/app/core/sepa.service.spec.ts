import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { SepaService } from './sepa.service';

describe('SepaService', () => {
  let h: ApiServiceHarness<SepaService>;

  beforeEach(() => {
    h = setupApiService(SepaService);
  });

  afterEach(() => h.http.verify());

  describe('Remesas', () => {
    it('listRemesas mapea period/periodKey y castea numéricos, traduciendo el estado', async () => {
      const promise = h.service.listRemesas('e1');
      const req = h.http.expectOne(`${API}/estates/e1/remesas`);
      req.flush([{
        id: 'r1', period: { label: 'Marzo 2026', periodKey: '2026-03' }, scheme: 'CORE',
        linesCount: 12, totalAmount: '1200.50', presentedAt: '2026-03-01T00:00:00.000Z', chargeDate: '2026-03-05T00:00:00.000Z',
        status: 'ConDevoluciones', charged: 10, returned: 2, pending: 0, returnedAmount: '100',
      }]);
      const [remesa] = await promise;
      expect(remesa.periodKey).toBe('2026-03');
      expect(remesa.amount).toBe(1200.5);
      expect(remesa.status).toBe('Con devoluciones');
      expect(remesa.presented).toBe('2026-03-01');
    });

    it('listRemesaCandidates renombra receiptId → id y castea amount', async () => {
      const promise = h.service.listRemesaCandidates('e1', '2026-03');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/remesas/candidates` && r.params.get('periodKey') === '2026-03');
      req.flush([{ receiptId: 'rec1', owner: 'x', unit: '1A', iban: 'ES1', mandate: true, seq: 'FRST', amount: '100' }]);
      const [c] = await promise;
      expect(c.id).toBe('rec1');
      expect(c.amount).toBe(100);
    });

    it('createRemesa manda el input tal cual', async () => {
      const input = { periodKey: '2026-03', chargeDate: '2026-03-05', scheme: 'CORE', concept: 'Cuotas marzo' };
      const promise = h.service.createRemesa('e1', input);
      const req = h.http.expectOne(`${API}/estates/e1/remesas`);
      expect(req.request.body).toEqual(input);
      req.flush({ id: 'r1' });
      await promise;
    });

    it('getRemesaFile pide el XML como texto plano', async () => {
      const promise = h.service.getRemesaFile('r1');
      const req = h.http.expectOne(`${API}/remesas/r1/file`);
      expect(req.request.responseType).toBe('text');
      req.flush('<xml>contenido</xml>');
      expect(await promise).toBe('<xml>contenido</xml>');
    });

    it('listRemesaLines castea amount', async () => {
      const promise = h.service.listRemesaLines('r1');
      const req = h.http.expectOne(`${API}/remesas/r1/lines`);
      req.flush([{ id: 'l1', owner: 'x', unit: '1A', iban: 'x', mandate: 'x', seq: 'FRST', amount: '50', status: 'Pendiente' }]);
      expect((await promise)[0].amount).toBe(50);
    });
  });

  describe('Mandatos', () => {
    it('findMandateById siempre devuelve null (sin GET /mandates/:id todavía)', async () => {
      expect(await h.service.findMandateById('m1')).toBeNull();
      h.http.expectNone(() => true);
    });

    it('listActiveMandatesForProperty filtra solo status=active y normaliza fechas', async () => {
      const promise = h.service.listActiveMandatesForProperty('p1');
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1/mandates` && r.params.get('all') === 'true');
      req.flush([
        { id: 'm1', status: 'active', signedAt: '2026-01-01T00:00:00.000Z', firstUseAt: null, lastUseAt: null },
        { id: 'm2', status: 'revoked', signedAt: '2025-01-01T00:00:00.000Z' },
        { id: 'm3', status: 'active', signedAt: '2026-02-01T00:00:00.000Z', firstUseAt: '2026-02-10T00:00:00.000Z' },
      ]);
      const result = await promise;
      expect(result.map((m) => m.id)).toEqual(['m1', 'm3']);
      expect(result[1].firstUseAt).toBe('2026-02-10');
    });

    it('listMandatesForProperty NO filtra por estado — trae todos', async () => {
      const promise = h.service.listMandatesForProperty('p1');
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1/mandates`);
      req.flush([
        { id: 'm1', status: 'active', signedAt: '2026-01-01' },
        { id: 'm2', status: 'revoked', signedAt: '2025-01-01' },
      ]);
      const result = await promise;
      expect(result).toHaveLength(2);
    });

    it('refreshMandateLifecycle siempre devuelve null (ciclo de vida server-side, sin endpoint de refresco)', async () => {
      expect(await h.service.refreshMandateLifecycle('m1')).toBeNull();
      h.http.expectNone(() => true);
    });
  });
  describe('Ficheros de devoluciones', () => {
    it('uploadReturnFile manda el fichero y mapea partidas, importes y línea', async () => {
      const file = new File(['<Document/>'], 'dev.xml');
      const promise = h.service.uploadReturnFile('e1', file);
      const req = h.http.expectOne(`${API}/estates/e1/return-files`);
      expect(req.request.method).toBe('POST');
      expect((req.request.body as FormData).get('file')).toBeTruthy();
      req.flush({
        id: 'f1', format: 'pain002', fileName: 'dev.xml', createdAt: '2026-03-04T08:00:00Z', lastAppliedAt: null, duplicate: false,
        counts: { matched: 1, unmatched: 0, applied: 0, already_returned: 0, failed: 0 },
        items: [{ id: 'i1', seq: 1, amount: '100.00', feeAmount: null, date: '2026-03-05T00:00:00.000Z', status: 'matched',
          remesaLine: { id: 'l1', amount: '100.00', ownerNameSnapshot: 'Ana', receipt: { no: 'R-1' }, property: { ref: '3B' }, remesa: { concept: 'Marzo' } } }],
      });
      const result = await promise;
      expect(result.duplicate).toBe(false);
      expect(result.items[0]).toMatchObject({ amount: 100, feeAmount: null, date: '2026-03-05', line: { unit: '3B', receiptNo: 'R-1', amount: 100 } });
    });

    it('listReturnFiles, getReturnFile y applyReturnFile', async () => {
      const list = h.service.listReturnFiles('e1');
      h.http.expectOne(`${API}/estates/e1/return-files`).flush([{ id: 'f1', counts: {}, items: undefined }]);
      expect((await list)[0].items).toEqual([]);

      const get = h.service.getReturnFile('f1');
      h.http.expectOne(`${API}/return-files/f1`).flush({ id: 'f1', counts: {}, items: [] });
      await get;

      const apply = h.service.applyReturnFile('f1');
      const req = h.http.expectOne(`${API}/return-files/f1/apply`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'f1', counts: {}, items: [], summary: { applied: 1, alreadyReturned: 0, failed: 0 } });
      expect((await apply).summary?.applied).toBe(1);
    });
  });
});
