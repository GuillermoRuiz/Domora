import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { OwnerDocumentsService } from './owner-documents.service';

describe('OwnerDocumentsService', () => {
  let h: ApiServiceHarness<OwnerDocumentsService>;

  beforeEach(() => {
    h = setupApiService(OwnerDocumentsService);
  });

  afterEach(() => h.http.verify());

  it('list sends every filter as a query param and leaves the empty ones out', async () => {
    const promise = h.service.list({ propertyId: 'p1', q: '  acta ', category: 'actas', from: '2026-01-01', to: '2026-12-31', fileType: 'pdf', onlyNew: true, sort: 'name_asc' });
    const req = h.http.expectOne((r) => r.url === `${API}/me/documents`);
    expect(req.request.method).toBe('GET');
    expect(Object.fromEntries(req.request.params.keys().map((k) => [k, req.request.params.get(k)]))).toEqual({
      propertyId: 'p1', q: 'acta', category: 'actas', from: '2026-01-01', to: '2026-12-31', fileType: 'pdf', onlyNew: 'true', sort: 'name_asc',
    });
    const body = { items: [], counts: { all: 0, actas: 0, economicos: 0, normativa: 0, seguros: 0, contratos: 0, otros: 0 } };
    req.flush(body);
    expect(await promise).toEqual(body);

    const bare = h.service.list({ q: '  ', onlyNew: false });
    const empty = h.http.expectOne((r) => r.url === `${API}/me/documents`);
    expect(empty.request.params.keys()).toEqual([]);
    empty.flush(body);
    await bare;
  });

  it('markRead posts the document ids', async () => {
    const promise = h.service.markRead(['d1', 'd2']);
    const req = h.http.expectOne(`${API}/me/documents/read`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ documentIds: ['d1', 'd2'] });
    req.flush({ marked: 2 });
    expect(await promise).toEqual({ marked: 2 });
  });

  it('file asks for the blob with its purpose', async () => {
    const view = h.service.file('d1', 'view');
    const req = h.http.expectOne(`${API}/documents/d1/file?purpose=view`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF-']));
    await view;

    const download = h.service.file('d1', 'download');
    h.http.expectOne(`${API}/documents/d1/file?purpose=download`).flush(new Blob(['x']));
    await download;
  });
});
