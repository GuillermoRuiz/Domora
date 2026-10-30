import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { OwnerIssuesService } from './owner-issues.service';

describe('OwnerIssuesService', () => {
  let h: ApiServiceHarness<OwnerIssuesService>;

  beforeEach(() => {
    h = setupApiService(OwnerIssuesService);
  });

  afterEach(() => h.http.verify());

  it('list sends the filters as query params (status comma-separated, empty ones left out)', async () => {
    const promise = h.service.list({ estateId: 'e1', q: '  ascensor ', status: ['Abierta', 'PendienteInformacion'] });
    const req = h.http.expectOne((r) => r.url === `${API}/me/issues`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('estateId')).toBe('e1');
    expect(req.request.params.get('q')).toBe('ascensor');
    expect(req.request.params.has('category')).toBe(false);
    expect(req.request.params.has('scope')).toBe(false);
    expect(req.request.params.has('propertyId')).toBe(false);
    expect(req.request.params.get('status')).toBe('Abierta,PendienteInformacion');
    const body = { items: [], kpis: { open: 1, inProgress: 0, resolved: 0 } };
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('list without filters sends no params', async () => {
    const promise = h.service.list({ q: '   ', status: [] });
    const req = h.http.expectOne((r) => r.url === `${API}/me/issues`);
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ items: [], kpis: { open: 0, inProgress: 0, resolved: 0 } });
    await promise;
  });

  it('create posts the issue in a community; locations and similar ask with the community', async () => {
    const input = { estateId: 'e1', type: 'Fuga' as const, title: 'Gotera', description: 'Cae agua', location: 'Garaje', urgent: true };
    const created = h.service.create(input);
    const post = h.http.expectOne(`${API}/me/issues`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(input);
    post.flush({ id: 'i1' });
    expect(await created).toEqual({ id: 'i1' });

    const locations = h.service.locations('e1');
    h.http.expectOne(`${API}/me/issues/locations?estateId=e1`).flush([{ label: 'Garaje' }]);
    expect(await locations).toEqual([{ label: 'Garaje' }]);

    const similar = h.service.similar('e1', 'gotera garaje');
    const req = h.http.expectOne((r) => r.url === `${API}/me/issues/similar`);
    expect(req.request.params.get('estateId')).toBe('e1');
    expect(req.request.params.get('q')).toBe('gotera garaje');
    req.flush([]);
    await similar;
  });

  it('follow-up actions hit their endpoints with their bodies', async () => {
    const calls: [Promise<unknown>, string, string, unknown][] = [
      [h.service.reply('i1', 'Adjunto la foto'), 'POST', `${API}/me/issues/i1/replies`, { text: 'Adjunto la foto' }],
      [h.service.withdraw('i1'), 'POST', `${API}/me/issues/i1/withdraw`, {}],
      [h.service.reopen('i1'), 'POST', `${API}/me/issues/i1/reopen`, {}],
      [h.service.rate('i1', 4, '  Rápido '), 'POST', `${API}/me/issues/i1/rating`, { rating: 4, comment: 'Rápido' }],
      [h.service.setAffected('i2', true), 'PUT', `${API}/me/issues/i2/affected`, {}],
    ];
    for (const [promise, method, url, body] of calls) {
      const req = h.http.expectOne(url);
      expect(req.request.method).toBe(method);
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'i1' });
      await promise;
    }
    const undo = h.service.setAffected('i2', false);
    const del = h.http.expectOne(`${API}/me/issues/i2/affected`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ id: 'i2' });
    await undo;
    const bare = h.service.rate('i1', 5, '   ');
    const rate = h.http.expectOne(`${API}/me/issues/i1/rating`);
    expect(rate.request.body).toEqual({ rating: 5 });
    rate.flush({ id: 'i1' });
    await bare;
  });

  it('uploads an attachment as multipart field "file" and downloads it as a blob', async () => {
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    const upload = h.service.uploadAttachment('i1', file);
    const post = h.http.expectOne(`${API}/issues/i1/photos`);
    expect(post.request.method).toBe('POST');
    expect((post.request.body as FormData).get('file')).toBeInstanceOf(File);
    post.flush({ id: 'a1' });
    expect(await upload).toEqual({ id: 'a1' });

    const download = h.service.downloadAttachment('i1', 'a1');
    const get = h.http.expectOne(`${API}/issues/i1/photos/a1/file`);
    expect(get.request.responseType).toBe('blob');
    get.flush(new Blob(['x']));
    expect(await download).toBeInstanceOf(Blob);
  });
});
