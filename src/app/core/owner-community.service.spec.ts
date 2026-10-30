import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { OwnerCommunityService } from './owner-community.service';

describe('OwnerCommunityService', () => {
  let h: ApiServiceHarness<OwnerCommunityService>;

  beforeEach(() => {
    h = setupApiService(OwnerCommunityService);
  });

  afterEach(() => h.http.verify());

  it('getPropertyOverview pide las fichas de la propiedad y devuelve la respuesta tal cual', async () => {
    const promise = h.service.getPropertyOverview('p1');
    const body = {
      propertyId: 'p1', estateId: 'e1', nextReceipt: { id: 'r1', concept: 'Cuota', amount: 125, dueDate: '2026-11-05', status: 'Pendiente' },
      requests: { open: 2, newLast30Days: 1 }, nextMeeting: null, documents: { newLast30Days: 3 },
    };
    const req = h.http.expectOne(`${API}/properties/p1/my-overview`);
    expect(req.request.method).toBe('GET');
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('getPropertyEvents pide los eventos de la propiedad', async () => {
    const promise = h.service.getPropertyEvents('p1');
    const events = [{ id: 'junta:1', kind: 'junta', title: 'Junta', subtitle: null, date: '2026-10-30', time: '18:00' }];
    h.http.expectOne(`${API}/properties/p1/my-events`).flush(events);
    expect(await promise).toEqual(events);
  });

  it('getCommunitySummary pide el resumen de la finca', async () => {
    const promise = h.service.getCommunitySummary('e1');
    const summary = { id: 'e1', name: 'Colón 24', indicators: { owners: 34, activeIssues: 4, commonAreas: 'buen_estado' } };
    h.http.expectOne(`${API}/estates/e1/community-summary`).flush(summary);
    expect(await promise).toEqual(summary);
  });

  it('un error de la API se propaga a quien llama', async () => {
    const promise = h.service.getPropertyOverview('p9');
    h.http.expectOne(`${API}/properties/p9/my-overview`).flush({ message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await expect(promise).rejects.toBeDefined();
  });
});
