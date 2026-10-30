import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { InspectionsService } from './inspections.service';
import type { EstateInstallations } from './installations.models';

describe('InspectionsService — instalaciones', () => {
  let h: ApiServiceHarness<InspectionsService>;

  beforeEach(() => {
    h = setupApiService(InspectionsService);
  });

  afterEach(() => h.http.verify());

  it('listInstallations pide el panel de la finca y devuelve el cuerpo tal cual', async () => {
    const body: EstateInstallations = {
      items: [{
        id: 'a1', name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', manufacturer: null, serialNumber: null, notes: null,
        operationalStatus: 'operativa', displayStatus: 'revision_proxima', supplier: { id: 's1', name: 'Ascensores Levante' },
        lastReviewDate: '2026-01-15', nextReviewDate: '2026-10-19', nextReviewDaysLeft: 3, openIssues: 1,
      }],
      upcoming: [],
    };
    const promise = h.service.listInstallations('e1');
    const req = h.http.expectOne(`${API}/estates/e1/installations`);
    expect(req.request.method).toBe('GET');
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('updateAsset hace PATCH solo con lo que cambia (null borra el proveedor)', async () => {
    const promise = h.service.updateAsset('e1', 'a1', { operationalStatus: 'en_mantenimiento', supplierId: null });
    const req = h.http.expectOne(`${API}/estates/e1/assets/a1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ operationalStatus: 'en_mantenimiento', supplierId: null });
    req.flush({ id: 'a1', estateId: 'e1', name: 'Ascensor A', category: 'Ascensor' });
    expect((await promise).id).toBe('a1');
  });

  it('createAsset envía estado operativo y proveedor', async () => {
    const promise = h.service.createAsset('e1', { name: 'Piscina', category: 'Piscina', operationalStatus: 'en_mantenimiento', supplierId: 's9' });
    const req = h.http.expectOne(`${API}/estates/e1/assets`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Piscina', category: 'Piscina', operationalStatus: 'en_mantenimiento', supplierId: 's9' });
    req.flush({ id: 'a2', estateId: 'e1', name: 'Piscina', category: 'Piscina' });
    expect((await promise).id).toBe('a2');
  });
});
