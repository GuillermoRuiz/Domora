import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { TicketsAdhesionService } from './tickets-adhesion.service';

describe('TicketsAdhesionService', () => {
  let h: ApiServiceHarness<TicketsAdhesionService>;

  beforeEach(() => {
    h = setupApiService(TicketsAdhesionService);
  });

  afterEach(() => h.http.verify());

  describe('Adhesion requests', () => {
    it('listAdhesionRequestsByEstate — GET simple', async () => {
      const promise = h.service.listAdhesionRequestsByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/adhesion-requests`);
      expect(req.request.params.keys()).toEqual([]);
      req.flush([{ id: 'r1', estateId: 'e1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', submittedAt: '2026-01-01', status: 'pending' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('listPendingAdhesionRequestsByEstate filtra por status=pending', async () => {
      const promise = h.service.listPendingAdhesionRequestsByEstate('e1');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests` && r.params.get('status') === 'pending');
      req.flush([]);
      await promise;
    });

    it('listAllPendingAdhesionRequests traduce el tipo de la finca embebida cuando viene', async () => {
      const promise = h.service.listAllPendingAdhesionRequests();
      const req = h.http.expectOne(`${API}/adhesion-requests`);
      req.flush([{ id: 'r1', estateId: 'e1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', submittedAt: '2026-01-01', status: 'pending', estate: { id: 'e1', type: 'Urbanizacion' } }]);
      const [r] = await promise;
      // `estate` no está declarado en el tipo AdhesionRequest pero el mapeo sí lo añade cuando viene embebido.
      expect((r as unknown as { estate: { type: string } }).estate.type).toBe('Urbanización');
    });

    it('listAllPendingAdhesionRequests sin finca embebida, no lanza', async () => {
      const promise = h.service.listAllPendingAdhesionRequests();
      const req = h.http.expectOne(`${API}/adhesion-requests`);
      req.flush([{ id: 'r1', estateId: 'e1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', submittedAt: '2026-01-01', status: 'pending' }]);
      expect((await promise)[0] as unknown as { estate?: unknown }).toEqual(expect.objectContaining({ estate: undefined }));
    });

    it('approveAdhesion — POST sin cuerpo relevante', async () => {
      const promise = h.service.approveAdhesion('e1', 'r1');
      const req = h.http.expectOne(`${API}/estates/e1/adhesion-requests/r1/approve`);
      expect(req.request.method).toBe('POST');
      req.flush(null);
      await promise;
    });

    it('rejectAdhesion manda las notas', async () => {
      const promise = h.service.rejectAdhesion('e1', 'r1', 'No corresponde a esta finca');
      const req = h.http.expectOne(`${API}/estates/e1/adhesion-requests/r1/reject`);
      expect(req.request.body).toEqual({ notes: 'No corresponde a esta finca' });
      req.flush(null);
      await promise;
    });
  });
});
