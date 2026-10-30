import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { MeetingVoteDelegationsService } from './meeting-vote-delegations.service';

describe('MeetingVoteDelegationsService', () => {
  let h: ApiServiceHarness<MeetingVoteDelegationsService>;

  beforeEach(() => {
    h = setupApiService(MeetingVoteDelegationsService);
  });

  afterEach(() => h.http.verify());

  it('list — GET simple', async () => {
    const promise = h.service.list('m1');
    h.http.expectOne(`${API}/meetings/m1/delegations`).flush([
      { id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1' },
    ]);
    expect((await promise)[0].id).toBe('d1');
  });

  it('listEligibleDelegators pasa la propiedad como query param', async () => {
    const promise = h.service.listEligibleDelegators('m1', 'p1');
    const req = h.http.expectOne((r) => r.url === `${API}/meetings/m1/delegations/eligible-delegators` && r.params.get('propertyId') === 'p1');
    req.flush([{ userId: 'u1', name: 'Ana' }]);
    expect((await promise)[0].name).toBe('Ana');
  });

  it('create manda representativeEmail, no un id', async () => {
    const input = { propertyId: 'p1', delegatorUserId: 'u1', representativeEmail: 'rep@demo.app', notes: 'nota' };
    const promise = h.service.create('m1', input);
    const req = h.http.expectOne(`${API}/meetings/m1/delegations`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1' });
    expect((await promise).id).toBe('d1');
  });

  it('revoke — PATCH :id/revoke con el motivo en el body', async () => {
    const promise = h.service.revoke('m1', 'd1', 'ya no hace falta');
    const req = h.http.expectOne(`${API}/meetings/m1/delegations/d1/revoke`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ reason: 'ya no hace falta' });
    req.flush({ id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', revokedAt: '2026-01-02' });
    expect((await promise).revokedAt).toBe('2026-01-02');
  });

  it('uploadDocument sube el fichero', async () => {
    const file = new File(['contenido'], 'poder.pdf', { type: 'application/pdf' });
    const promise = h.service.uploadDocument('m1', 'd1', file);
    const req = h.http.expectOne(`${API}/meetings/m1/delegations/d1/document`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush({ id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', documentS3Key: 'k1' });
    expect((await promise).documentS3Key).toBe('k1');
  });

  it('downloadDocument pide un blob', async () => {
    const promise = h.service.downloadDocument('m1', 'd1');
    const req = h.http.expectOne(`${API}/meetings/m1/delegations/d1/document/file`);
    req.flush(new Blob(['pdf']));
    await expect(promise).resolves.toBeInstanceOf(Blob);
  });
});
