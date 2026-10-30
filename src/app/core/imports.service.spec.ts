import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { ImportsService } from './imports.service';

describe('ImportsService', () => {
  let h: ApiServiceHarness<ImportsService>;

  beforeEach(() => {
    h = setupApiService(ImportsService);
  });

  afterEach(() => h.http.verify());

  it('listImportBatches — GET simple', async () => {
    const promise = h.service.listImportBatches('e1');
    const req = h.http.expectOne(`${API}/estates/e1/imports`);
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'b1', estateId: 'e1', status: 'ready' }]);
    expect((await promise)[0].id).toBe('b1');
  });

  it('getImportBatch — GET por id', async () => {
    const promise = h.service.getImportBatch('e1', 'b1');
    const req = h.http.expectOne(`${API}/estates/e1/imports/b1`);
    req.flush({ id: 'b1', estateId: 'e1', status: 'validating' });
    expect((await promise).status).toBe('validating');
  });

  describe('getImportPresets', () => {
    it('sin headers, no manda el parámetro', async () => {
      const promise = h.service.getImportPresets('e1', 'GESFINCAS_NET', 'property');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/imports/presets`);
      expect(req.request.params.get('platform')).toBe('GESFINCAS_NET');
      expect(req.request.params.get('entityType')).toBe('property');
      expect(req.request.params.has('headers')).toBe(false);
      req.flush({ fields: [], suggestedMapping: {} });
      await promise;
    });

    it('con headers, los une con coma', async () => {
      const promise = h.service.getImportPresets('e1', 'GESFINCAS_NET', 'owner', ['Nombre', 'Referencia']);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/imports/presets`);
      expect(req.request.params.get('headers')).toBe('Nombre,Referencia');
      req.flush({ fields: [], suggestedMapping: { Nombre: 'name' } });
      const res = await promise;
      expect(res.suggestedMapping['Nombre']).toBe('name');
    });
  });

  it('createImportBatch — multipart con sourcePlatform y scope', async () => {
    const file = new File(['a,b\n1,2'], 'propietarios.csv');
    const promise = h.service.createImportBatch('e1', file, 'GESFINCAS_NET', 'current_state');
    const req = h.http.expectOne(`${API}/estates/e1/imports`);
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('sourcePlatform')).toBe('GESFINCAS_NET');
    expect(body.get('scope')).toBe('current_state');
    req.flush({ id: 'b1', estateId: 'e1', status: 'uploading' });
    expect((await promise).id).toBe('b1');
  });

  it('parseImportBatch — POST sin cuerpo relevante', async () => {
    const promise = h.service.parseImportBatch('e1', 'b1');
    const req = h.http.expectOne(`${API}/estates/e1/imports/b1/parse`);
    expect(req.request.method).toBe('POST');
    req.flush({ headers: ['Nombre'], sampleRows: [{ Nombre: 'x' }], totalRows: 1 });
    expect((await promise).totalRows).toBe(1);
  });

  it('validateImportMapping — manda entityType y mapping', async () => {
    const mapping = { Nombre: 'name' };
    const promise = h.service.validateImportMapping('e1', 'b1', 'owner', mapping);
    const req = h.http.expectOne(`${API}/estates/e1/imports/b1/validate`);
    expect(req.request.body).toEqual({ entityType: 'owner', mapping });
    req.flush({ summary: { entityType: 'owner', totalRows: 1, okRows: 1, errorCount: 0, warningCount: 0, errors: [], warnings: [] } });
    const res = await promise;
    expect(res.summary.okRows).toBe(1);
  });

  it('commitImportBatch — POST sin cuerpo', async () => {
    const promise = h.service.commitImportBatch('e1', 'b1');
    const req = h.http.expectOne(`${API}/estates/e1/imports/b1/commit`);
    expect(req.request.method).toBe('POST');
    req.flush({
      entityType: 'owner', totalRows: 1, okRows: 1, errorCount: 0, warningCount: 0, errors: [], warnings: [],
      committed: { createdCount: 1, skippedCount: 0, skippedReasons: [] },
    });
    expect((await promise).committed.createdCount).toBe(1);
  });

  it('rollbackImportBatch — POST sin cuerpo, devuelve los contadores de filas removidas', async () => {
    const promise = h.service.rollbackImportBatch('e1', 'b1');
    const req = h.http.expectOne(`${API}/estates/e1/imports/b1/rollback`);
    expect(req.request.method).toBe('POST');
    req.flush({ removedProperties: 2, removedOwners: 1, reversedEntries: 0, removedReceipts: 0, removedRemesas: 0, removedRemesaLines: 0 });
    expect((await promise).removedProperties).toBe(2);
  });
});
