import { API, setupApiService, ApiServiceHarness } from './testing/data-service-harness';
import { HttpErrorResponse } from '@angular/common/http';
import { ReportingService, reportError } from './reporting.service';
import { TEST_CATALOG, TEST_RESULT } from '../features/reports/reporting.fixtures.spec-helper';

describe('ReportingService', () => {
  let h: ApiServiceHarness<ReportingService>;
  beforeEach(() => h = setupApiService(ReportingService));
  afterEach(() => h.http.verify());
  it('consulta catálogo y scope fresco sin silenciar errores', async () => {
    const catalog = h.service.catalog();
    h.http.expectOne(`${API}/reports/catalog`).flush(TEST_CATALOG);
    expect(await catalog).toEqual(TEST_CATALOG);
    const estates = h.service.estates();
    const rejected = expect(estates).rejects.toMatchObject({ status: 403 });
    h.http.expectOne(`${API}/reports/estates`).flush({}, { status: 403, statusText: 'Forbidden' });
    await rejected;
  });
  it('envía IDs y filtros en el cuerpo y descarga un archivo real', async () => {
    const input = { scopeMode: 'selected' as const, estateIds: ['e1'], fiscalYear: 2026 };
    const query = h.service.query('trial-balance', input);
    const req = h.http.expectOne(`${API}/reports/trial-balance/query`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush(TEST_RESULT);
    expect(await query).toEqual(TEST_RESULT);
    const exported = h.service.export('trial-balance', input, 'pdf');
    const exportReq = h.http.expectOne(`${API}/reports/trial-balance/export`);
    expect(exportReq.request.body).toEqual({ ...input, format: 'pdf' });
    expect(exportReq.request.responseType).toBe('blob');
    exportReq.flush(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    expect((await exported).type).toBe('application/pdf');
  });
  it('exporta la versión conservada cuando la vista previa entrega una referencia', async () => {
    const input = { scopeMode: 'selected' as const, estateIds: ['e1'], from: '2026-09-01', to: '2026-09-30' };
    const exported = h.service.export('monthly-executive', input, 'xlsx', 'snapshot-1');
    const request = h.http.expectOne(`${API}/reports/monthly-executive/export`);
    expect(request.request.body).toEqual({ ...input, format: 'xlsx', snapshotId: 'snapshot-1' });
    request.flush(new Blob(['xlsx']));
    expect(await exported).toBeInstanceOf(Blob);
  });
  it.each([401, 403, 404, 500])('conserva el error HTTP %s del catálogo sin convertirlo en vacío', async status => {
    const pending = h.service.catalog();
    const rejected = expect(pending).rejects.toMatchObject({ status });
    h.http.expectOne(`${API}/reports/catalog`).flush({}, { status, statusText: 'Failure' });
    await rejected;
  });
  it('normaliza únicamente una respuesta vacía 200 y conserva el error de red', async () => {
    const empty = h.service.catalog();
    h.http.expectOne(`${API}/reports/catalog`).flush([]);
    expect(await empty).toEqual({ categories: [], reports: [] });
    const pending = h.service.catalog();
    const rejected = expect(pending).rejects.toMatchObject({ status: 0 });
    h.http.expectOne(`${API}/reports/catalog`).error(new ProgressEvent('error'));
    await rejected;
  });
  it('distingue autorización, no encontrado, servidor y red sin mostrar excepciones internas', () => {
    const messages = [401, 403, 404, 500, 0].map(status => reportError(new HttpErrorResponse({ status, error: { message: 'private stack trace' } })));
    expect(new Set(messages).size).toBe(5);
    expect(messages.join(' ')).not.toContain('private stack trace');
  });
});
