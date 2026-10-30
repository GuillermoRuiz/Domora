import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { DocumentLibraryService } from './document-library.service';

describe('DocumentLibraryService', () => {
  let h: ApiServiceHarness<DocumentLibraryService>;

  beforeEach(() => {
    h = setupApiService(DocumentLibraryService);
  });

  afterEach(() => h.http.verify());

  it('file sends the purpose when given (preview logs `view`)', async () => {
    const view = h.service.file('d1', 'view');
    h.http.expectOne(`${API}/documents/d1/file?purpose=view`).flush(new Blob(['%PDF-']));
    await view;
  });

  it('file without a purpose keeps the plain URL (existing downloads)', async () => {
    const plain = h.service.file('d1');
    h.http.expectOne(`${API}/documents/d1/file`).flush(new Blob(['x']));
    await plain;
  });
});
