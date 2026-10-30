import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { ResourceReadsService } from './resource-reads.service';

describe('ResourceReadsService', () => {
  let h: ApiServiceHarness<ResourceReadsService>;

  beforeEach(() => {
    h = setupApiService(ResourceReadsService);
  });

  afterEach(() => h.http.verify());

  describe('Resource reads (genérico)', () => {
    it('isResourceRead siempre devuelve false (sin endpoint de lectura individual todavía)', async () => {
      expect(await h.service.isResourceRead('u1', 'document', 'd1')).toBe(false);
      h.http.expectNone(() => true);
    });

    it('markResourceRead manda sourceType/sourceId', async () => {
      const promise = h.service.markResourceRead('u1', 'communication', 'c1');
      const req = h.http.expectOne(`${API}/resource-reads`);
      expect(req.request.body).toEqual({ sourceType: 'communication', sourceId: 'c1' });
      req.flush(null);
      await promise;
    });

    it('isAlertRead/markAlertRead (deprecados) delegan en isResourceRead/markResourceRead', async () => {
      expect(await h.service.isAlertRead('u1', 'issue', 'i1')).toBe(false);

      const promise = h.service.markAlertRead('u1', 'issue', 'i1');
      const req = h.http.expectOne(`${API}/resource-reads`);
      expect(req.request.body).toEqual({ sourceType: 'issue', sourceId: 'i1' });
      req.flush(null);
      await promise;
    });

    it('markAllAlertsRead — POST sin cuerpo relevante', async () => {
      const promise = h.service.markAllAlertsRead();
      const req = h.http.expectOne(`${API}/alerts/read-all`);
      expect(req.request.method).toBe('POST');
      req.flush(null);
      await promise;
    });
  });

  describe('Comunicados/documentos — estado de lectura por usuario', () => {
    it('isCommunicationRead delega en isResourceRead con sourceType communication', async () => {
      expect(await h.service.isCommunicationRead('u1', 'c1')).toBe(false);
    });

    it('markCommunicationRead delega en markResourceRead', async () => {
      const promise = h.service.markCommunicationRead('u1', 'c1');
      const req = h.http.expectOne(`${API}/resource-reads`);
      expect(req.request.body).toEqual({ sourceType: 'communication', sourceId: 'c1' });
      req.flush(null);
      await promise;
    });

    it('isDocumentUnseen niega isResourceRead — "no leído" = "no visto"', async () => {
      expect(await h.service.isDocumentUnseen('u1', 'd1')).toBe(true);
    });

    it('markDocumentRead delega en markResourceRead', async () => {
      const promise = h.service.markDocumentRead('u1', 'd1');
      const req = h.http.expectOne(`${API}/resource-reads`);
      expect(req.request.body).toEqual({ sourceType: 'document', sourceId: 'd1' });
      req.flush(null);
      await promise;
    });

    it('downloadDocumentFile pide un blob', async () => {
      const promise = h.service.downloadDocumentFile('d1');
      const req = h.http.expectOne(`${API}/documents/d1/file`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(await promise).toBeInstanceOf(Blob);
    });
  });

  describe('Alerts', () => {
    it('listAlertsForUser normaliza la fecha de cada alerta', async () => {
      const promise = h.service.listAlertsForUser(undefined, 6);
      const req = h.http.expectOne(
        (request) =>
          request.url === `${API}/alerts` && request.params.get('limit') === '6',
      );
      req.flush([{ id: 'receipt:r1', sourceType: 'receipt', sourceId: 'r1', userId: 'u1', type: 'pago', title: 'x', description: 'x', date: '2026-01-01T00:00:00.000Z', urgent: true, read: false }]);
      expect((await promise)[0].date).toBe('2026-01-01');
    });
  });

  describe('Activity feed', () => {
    it('listActivityForUser pasa el limit y normaliza fechas', async () => {
      const promise = h.service.listActivityForUser(undefined, 5);
      const req = h.http.expectOne((r) => r.url === `${API}/activity` && r.params.get('limit') === '5');
      req.flush([{ id: 'a1', type: 'incidencia', title: 'x', description: 'x', date: '2026-01-01T00:00:00.000Z', propertyId: 'p1' }]);
      expect((await promise)[0].date).toBe('2026-01-01');
    });

    it('listActivityForUser usa limit=10 por defecto', async () => {
      const promise = h.service.listActivityForUser();
      const req = h.http.expectOne((r) => r.url === `${API}/activity` && r.params.get('limit') === '10');
      req.flush([]);
      await promise;
    });

    it('logActivity genera un id sintético client-side (sin endpoint de escritura en el backend)', async () => {
      const entry = await h.service.logActivity({ subjectType: 'issue', subjectId: 'i1', verb: 'created', summary: 'x', occurredAt: '2026-01-01' });
      expect(entry.id).toMatch(/^act\d+$/);
      h.http.expectNone(() => true);
    });
  });
});
