import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { ComunicadosService } from './comunicados.service';

describe('ComunicadosService', () => {
  let h: ApiServiceHarness<ComunicadosService>;

  beforeEach(() => {
    h = setupApiService(ComunicadosService);
  });

  afterEach(() => h.http.verify());

  it('listCommunicationsByEstate pasa page/pageSize', async () => {
    const promise = h.service.listCommunicationsByEstate('e1', { page: 1, pageSize: 20 });
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.params.get('page') === '1' && r.params.get('pageSize') === '20');
    req.flush({ items: [{ id: 'c1', title: 'x', body: 'x', date: '2026-01-01', from: 'Gestora', read: false }], total: 1, page: 1, pageSize: 20 });
    const res = await promise;
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('listDocumentsByEstate pasa page/pageSize', async () => {
    const promise = h.service.listDocumentsByEstate('e1', { page: 2, pageSize: 30 });
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/documents` && r.params.get('page') === '2' && r.params.get('pageSize') === '30');
    req.flush({ items: [{ id: 'd1', title: 'x', type: 'Otro', date: '2026-01-01', size: '1 KB', isNew: true }], total: 1, page: 2, pageSize: 30 });
    const res = await promise;
    expect(res.items[0].isNew).toBe(true);
  });

  it('uploadDocument manda el fichero y los campos opcionales como multipart', async () => {
    const file = new File(['x'], 'estatutos.pdf');
    const promise = h.service.uploadDocument('e1', file, { title: 'Estatutos', type: 'Estatutos', targetPropertyId: 'p1' });
    const req = h.http.expectOne(`${API}/estates/e1/documents/upload`);
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('title')).toBe('Estatutos');
    expect(body.get('targetPropertyId')).toBe('p1');
    req.flush({ id: 'd1', title: 'Estatutos', type: 'Estatutos', date: '2026-01-01', size: '1 KB' });
    await promise;
  });

  it('uploadDocument sin targetPropertyId, no lo añade al formulario (documento general)', async () => {
    const file = new File(['x'], 'acta.pdf');
    const promise = h.service.uploadDocument('e1', file, { title: 'Acta' });
    const req = h.http.expectOne(`${API}/estates/e1/documents/upload`);
    const body = req.request.body as FormData;
    expect(body.get('targetPropertyId')).toBeNull();
    req.flush({ id: 'd1', title: 'Acta', type: 'Acta', date: '2026-01-01', size: '1 KB' });
    await promise;
  });

  it('setCommunicationPinned manda el toggle', async () => {
    const promise = h.service.setCommunicationPinned('c1', true);
    const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/pin` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ pinned: true });
    req.flush(null);
    await promise;
  });

  it('addCommunicationReply manda el texto', async () => {
    const promise = h.service.addCommunicationReply('c1', 'Gracias por avisar');
    const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/replies` && r.method === 'POST');
    expect(req.request.body).toEqual({ text: 'Gracias por avisar' });
    req.flush({ id: 'r1', communicationId: 'c1', authorName: 'x', role: 'Propietario', text: 'Gracias por avisar', createdAt: '2026-01-01' });
    await promise;
  });

  it('deleteCommunicationReply — DELETE', async () => {
    const promise = h.service.deleteCommunicationReply('c1', 'r1');
    const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/replies/r1` && r.method === 'DELETE');
    req.flush(null);
    await promise;
  });

  it('listCommunicationReads pide las lecturas', async () => {
    const promise = h.service.listCommunicationReads('c1');
    const req = h.http.expectOne(`${API}/communications/c1/reads`);
    req.flush([{ userId: 'u1', fullName: 'Vecino Uno', read: true, readAt: '2026-01-02' }]);
    const reads = await promise;
    expect(reads[0].fullName).toBe('Vecino Uno');
  });

  it('uploadCommunicationAttachment sube el fichero como multipart', async () => {
    const file = new File(['x'], 'poliza.pdf');
    const promise = h.service.uploadCommunicationAttachment('c1', file, 'Póliza');
    const req = h.http.expectOne(`${API}/communications/c1/attachments`);
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('title')).toBe('Póliza');
    req.flush({ id: 'a1', communicationId: 'c1', title: 'Póliza', uploadedAt: '2026-01-01' });
    await promise;
  });

  it('downloadCommunicationAttachmentFile pide un blob', async () => {
    const promise = h.service.downloadCommunicationAttachmentFile('c1', 'a1');
    const req = h.http.expectOne(`${API}/communications/c1/attachments/a1/file`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect(await promise).toBeInstanceOf(Blob);
  });
});
