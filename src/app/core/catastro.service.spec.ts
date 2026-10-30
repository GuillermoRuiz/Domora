import { API, setupApiService } from './testing/data-service-harness';
import { CatastroService } from './catastro.service';
import type { CatastroUnit } from './models';

function makeUnit(overrides: Partial<CatastroUnit> = {}): CatastroUnit {
  return {
    cadastralReference: '2853604VK4725D0001YP', type: 'Piso', use: 'Residencial',
    viaType: 'Calle', viaName: 'Alcala', streetNumber: '100', streetNumberSuffix: null,
    block: null, staircase: '1', floor: '2', door: 'A', postalCode: '28009',
    municipality: 'Madrid', province: 'Madrid', builtAreaM2: 80, participationQuota: 2.5,
    alreadyImported: false,
    ...overrides,
  };
}

describe('CatastroService', () => {
  it('lookup por referencia: POST a la finca con el cuerpo tal cual', async () => {
    const { service, http } = setupApiService(CatastroService);

    const promise = service.lookup('e1', { refCat: '2853604VK4725D' });
    const req = http.expectOne(`${API}/estates/e1/catastro/lookup`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refCat: '2853604VK4725D' });
    req.flush({ units: [], warnings: [], source: {} });
    await promise;
  });

  it('lookup por dirección: envía los cinco campos', async () => {
    const { service, http } = setupApiService(CatastroService);
    const query = { provincia: 'MADRID', municipio: 'MADRID', sigla: 'CL', calle: 'ALCALA', numero: '100' };

    const promise = service.lookup('e1', query);
    const req = http.expectOne(`${API}/estates/e1/catastro/lookup`);
    expect(req.request.body).toEqual(query);
    req.flush({});
    await promise;
  });

  it('importUnits: envía SOLO los campos que acepta el backend (su validación es estricta)', async () => {
    const { service, http } = setupApiService(CatastroService);

    const promise = service.importUnits('e1', {
      parcelReference: '2853604VK4725D',
      fetchedAt: '2026-09-20T10:00:00.000Z',
      units: [makeUnit()],
    });
    const req = http.expectOne(`${API}/estates/e1/catastro/import`);
    const body = req.request.body as { parcelReference: string; fetchedAt: string; units: Record<string, unknown>[] };
    expect(body.parcelReference).toBe('2853604VK4725D');
    expect(body.fetchedAt).toBe('2026-09-20T10:00:00.000Z');
    expect(body.units[0]).not.toHaveProperty('alreadyImported');
    expect(body.units[0]).not.toHaveProperty('use');
    expect(body.units[0]).toMatchObject({
      cadastralReference: '2853604VK4725D0001YP', type: 'Piso', floor: '2', participationQuota: 2.5, builtAreaM2: 80,
    });
    req.flush({ created: 1, skipped: 0 });
    expect(await promise).toEqual({ created: 1, skipped: 0 });
  });

  it('catálogos: provincias, municipios y calles pasan los parámetros por query string', async () => {
    const { service, http } = setupApiService(CatastroService);

    const p1 = service.provinces();
    http.expectOne(`${API}/catastro/provinces`).flush([{ code: '28', name: 'MADRID' }]);
    expect(await p1).toEqual([{ code: '28', name: 'MADRID' }]);

    const p2 = service.municipalities('MADRID', 'alco');
    const r2 = http.expectOne((r) => r.url === `${API}/catastro/municipalities`);
    expect(r2.request.params.get('province')).toBe('MADRID');
    expect(r2.request.params.get('q')).toBe('alco');
    r2.flush([]);
    await p2;

    const p3 = service.streets('MADRID', 'MADRID', 'alc');
    const r3 = http.expectOne((r) => r.url === `${API}/catastro/streets`);
    expect(r3.request.params.get('municipality')).toBe('MADRID');
    r3.flush([]);
    await p3;
  });
});
