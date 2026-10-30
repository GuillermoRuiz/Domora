import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { EstatesService } from './estates.service';
import { TestBed } from '@angular/core/testing';
import { DespachoContextService } from './despacho-context.service';
import { makeUser } from './testing/data-service-harness';

describe('EstatesService', () => {
  let h: ApiServiceHarness<EstatesService>;

  beforeEach(() => {
    h = setupApiService(EstatesService);
  });

  afterEach(() => h.http.verify());

  describe('mapEstate (vía listEstates/findEstateById/createEstate/updateEstate)', () => {
    it('listEstates traduce el tipo (sin acentos → con acentos) y castea reserveTarget a número', async () => {
      const promise = h.service.listEstates();
      const req = h.http.expectOne(`${API}/estates`);
      expect(req.request.method).toBe('GET');
      req.flush([
        { id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'Urbanizacion', address: 'C/ Falsa 1', location: 'Madrid', reserveTarget: '1500.75' },
      ]);
      const [estate] = await promise;
      expect(estate.type).toBe('Urbanización');
      expect(estate.reserveTarget).toBe(1500.75);
    });

    it('reserveTarget ausente cae a 0, no a NaN/undefined', async () => {
      const promise = h.service.listEstates();
      const req = h.http.expectOne(`${API}/estates`);
      req.flush([{ id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'Edificio', address: 'x', location: 'x' }]);
      const [estate] = await promise;
      expect(estate.reserveTarget).toBe(0);
    });

    it('un tipo desconocido pasa tal cual (fallback ?? raw.type)', async () => {
      const promise = h.service.listEstates();
      const req = h.http.expectOne(`${API}/estates`);
      req.flush([{ id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'TipoRaro', address: 'x', location: 'x', reserveTarget: '0' }]);
      const [estate] = await promise;
      expect(estate.type).toBe('TipoRaro');
    });

    it('findEstateById mapea igual que listEstates', async () => {
      const promise = h.service.findEstateById('e1');
      const req = h.http.expectOne(`${API}/estates/e1`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'Garaje', address: 'x', location: 'x', reserveTarget: '200' });
      const estate = await promise;
      expect(estate?.type).toBe('Garaje');
      expect(estate?.reserveTarget).toBe(200);
    });

    it('findEstateById devuelve null si la petición falla (404)', async () => {
      const promise = h.service.findEstateById('no-existe');
      const req = h.http.expectOne(`${API}/estates/no-existe`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });

    it('createEstate traduce el tipo a la API (con acentos → sin acentos) y aplica reserveTarget=0 por defecto', async () => {
      const promise = h.service.createEstate({
        name: 'Nueva finca', type: 'Urbanización', address: 'C/ Nueva 1', location: 'Sevilla',
      } as never);
      const req = h.http.expectOne(`${API}/estates`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(expect.objectContaining({ type: 'Urbanizacion', reserveTarget: 0 }));
      req.flush({ id: 'e2', administratorId: 'a1', name: 'Nueva finca', type: 'Urbanizacion', address: 'x', location: 'x', reserveTarget: '0' });
      const estate = await promise;
      expect(estate.type).toBe('Urbanización');
    });

    it('createEstate envía provincia, código postal y referencia catastral (el backend tiene whitelist estricta)', async () => {
      const promise = h.service.createEstate({
        name: 'Nueva finca', type: 'Edificio', address: 'C/ Nueva 1', location: 'Madrid',
        province: 'Madrid', postalCode: '28009', cadastralReference: '2853604VK4725D',
      } as never);
      const req = h.http.expectOne(`${API}/estates`);
      expect(req.request.body).toEqual(expect.objectContaining({
        province: 'Madrid', postalCode: '28009', cadastralReference: '2853604VK4725D',
      }));
      req.flush({ id: 'e2', administratorId: 'a1', name: 'Nueva finca', type: 'Edificio', address: 'x', location: 'x', reserveTarget: '0' });
      await promise;
    });

    it('updateEstate solo traduce el tipo si viene en el patch (no rompe patches sin type)', async () => {
      const promise = h.service.updateEstate('e1', { name: 'Renombrada' });
      const req = h.http.expectOne(`${API}/estates/e1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Renombrada' });
      req.flush({ id: 'e1', administratorId: 'a1', name: 'Renombrada', type: 'Edificio', address: 'x', location: 'x', reserveTarget: '0' });
      await promise;
    });

    it('updateEstate traduce el tipo cuando sí viene en el patch', async () => {
      const promise = h.service.updateEstate('e1', { type: 'Local' });
      const req = h.http.expectOne(`${API}/estates/e1`);
      expect(req.request.body).toEqual({ type: 'Local' });
      req.flush({ id: 'e1', administratorId: 'a1', name: 'x', type: 'Local', address: 'x', location: 'x', reserveTarget: '0' });
      await promise;
    });
  });

  describe('estateColor (helper puro)', () => {
    it('devuelve el color explícito si el estate tiene uno', () => {
      expect(h.service.estateColor({ id: 'e1', color: '#FF00FF' })).toBe('#FF00FF');
    });

    it('sin color, deriva uno determinista de la paleta a partir del id', () => {
      const c1 = h.service.estateColor({ id: 'estate-abc', color: null });
      const c2 = h.service.estateColor({ id: 'estate-abc', color: null });
      expect(c1).toBe(c2);
      expect(c1).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('ids distintos pueden (no necesariamente deben) derivar colores distintos, pero el resultado siempre pertenece a la paleta', () => {
      const color = h.service.estateColor({ id: 'otro-id-cualquiera', color: undefined });
      const palette = ['#8B5E34', '#3B6E8F', '#4A7C59', '#7A4B8C', '#B0472B', '#2F6F6B', '#6B5B95', '#8C6A2F', '#4B6584', '#8E4A62'];
      expect(palette).toContain(color);
    });
  });

  describe('SEPA billing de la finca', () => {
    it('getEstateSepaBilling — GET simple', async () => {
      const promise = h.service.getEstateSepaBilling('e1');
      const req = h.http.expectOne(`${API}/estates/e1/sepa-billing`);
      expect(req.request.method).toBe('GET');
      req.flush({ creditorId: 'ES1234567890123456', creditorIban: '****1234' });
      expect((await promise).creditorId).toBe('ES1234567890123456');
    });

    it('updateEstateSepaBilling — PATCH con el patch tal cual', async () => {
      const promise = h.service.updateEstateSepaBilling('e1', { creditorBic: 'BSCHESMM' });
      const req = h.http.expectOne(`${API}/estates/e1/sepa-billing`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ creditorBic: 'BSCHESMM' });
      req.flush({ creditorBic: 'BSCHESMM' });
      await promise;
    });
  });

  describe('searchEstates', () => {
    it('con menos de 2 caracteres, no llama a la API — devuelve [] directo', async () => {
      const result = await h.service.searchEstates('a');
      expect(result).toEqual([]);
      h.http.expectNone(`${API}/estates/search`);
    });

    it('con 2+ caracteres, llama a /estates/search con el término', async () => {
      const promise = h.service.searchEstates('Finca Sol');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/search` && r.params.get('q') === 'Finca Sol');
      req.flush([{ id: 'e1', name: 'Finca Sol', address: 'x' }]);
      expect((await promise)[0].name).toBe('Finca Sol');
    });

    it('recorta espacios en blanco antes de decidir si busca (" a " sigue sin llegar a 2 caracteres útiles)', async () => {
      const result = await h.service.searchEstates('  a  ');
      // trim().length === 1 < 2 → no busca
      expect(result).toEqual([]);
    });
  });

  describe('Creditor ID (CID)', () => {
    it('getCreditorIdForEstate lo lee del estate resuelto', async () => {
      const promise = h.service.getCreditorIdForEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1`);
      req.flush({ id: 'e1', administratorId: 'a1', name: 'x', type: 'Edificio', address: 'x', location: 'x', reserveTarget: '0', creditorId: 'ES23000B12345674' });
      expect(await promise).toBe('ES23000B12345674');
    });

    it('getCreditorIdForEstate devuelve null si el estate no tiene creditorId', async () => {
      const promise = h.service.getCreditorIdForEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1`);
      req.flush({ id: 'e1', administratorId: 'a1', name: 'x', type: 'Edificio', address: 'x', location: 'x', reserveTarget: '0' });
      expect(await promise).toBeNull();
    });

    describe('isValidSpanishCreditorId (checksum ISO 7064 MOD 97-10, helper puro)', () => {
      // Mismo vector conocido-válido que ya se usa en los tests de backend
      // (backend/src/sepa/sepa-pain008.service.spec.ts) — calculado a mano,
      // no derivado circularmente del propio validador.
      const VALID_CID = 'ES90000B98765432';

      it('acepta un CID válido conocido', () => {
        expect(h.service.isValidSpanishCreditorId(VALID_CID)).toBe(true);
      });

      it('rechaza longitud distinta de 16', () => {
        expect(h.service.isValidSpanishCreditorId('ES9000B98765432')).toBe(false);
      });

      it('rechaza si no empieza por ES', () => {
        expect(h.service.isValidSpanishCreditorId('FR90000B98765432')).toBe(false);
      });

      it('rechaza dígitos de control no numéricos', () => {
        expect(h.service.isValidSpanishCreditorId('ESXX000B98765432')).toBe(false);
      });

      it('rechaza un NIF con formato inválido (letra final fuera de [A-Z0-9])', () => {
        expect(h.service.isValidSpanishCreditorId('ES90000B9876543!')).toBe(false);
      });

      it('rechaza un checksum incorrecto (un dígito cambiado sobre un CID válido)', () => {
        const tampered = VALID_CID.slice(0, -1) + (VALID_CID.endsWith('2') ? '3' : '2');
        expect(h.service.isValidSpanishCreditorId(tampered)).toBe(false);
      });

      it('rechaza cadena vacía', () => {
        expect(h.service.isValidSpanishCreditorId('')).toBe(false);
      });
    });
  });

  describe('foto de la finca', () => {
    it('getEstatePhoto pide la imagen como blob con la versión en la URL (para no servir una antigua)', async () => {
      const promise = h.service.getEstatePhoto('e1', '2026-10-17T10:00:00.000Z');
      const req = h.http.expectOne((r) => r.url.startsWith(`${API}/estates/e1/photo`));
      expect(req.request.urlWithParams).toBe(`${API}/estates/e1/photo?v=2026-10-17T10%3A00%3A00.000Z`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x'], { type: 'image/png' }));
      expect((await promise).type).toBe('image/png');
    });

    it('uploadEstatePhoto sube el fichero en el campo "file" y devuelve la finca mapeada', async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'fachada.png', { type: 'image/png' });
      const promise = h.service.uploadEstatePhoto('e1', file);
      const req = h.http.expectOne(`${API}/estates/e1/photo`);
      expect(req.request.method).toBe('POST');
      expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
      req.flush({ id: 'e1', type: 'Edificio', reserveTarget: '0', photoUpdatedAt: '2026-10-17T10:00:00.000Z' });
      expect(await promise).toMatchObject({ id: 'e1', type: 'Edificio', photoUpdatedAt: '2026-10-17T10:00:00.000Z' });
    });

    it('removeEstatePhoto hace DELETE y devuelve la finca sin foto', async () => {
      const promise = h.service.removeEstatePhoto('e1');
      const req = h.http.expectOne(`${API}/estates/e1/photo`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ id: 'e1', type: 'Edificio', reserveTarget: '0', photoUpdatedAt: null });
      expect((await promise).photoUpdatedAt).toBeNull();
    });
  });
  describe('despacho filter (role A, odd/tasks/role-a-panel.md S1)', () => {
    const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });
    const roleB = makeUser({ id: 'b1', role: 'B', administratorId: 'admin1' });
    const overviewQuery = { search: '', filter: 'all', types: [], sort: 'name', direction: 'asc', page: 1, pageSize: 12 } as any;

    beforeEach(() => sessionStorage.clear());
    afterEach(() => sessionStorage.clear());

    function selectDespacho(): void {
      h.setCurrentUser(roleA);
      TestBed.inject(DespachoContextService).select({ id: 'd1', name: 'Fincas García' });
    }

    it('role A with a selected despacho sends ?administratorId= on the estate list, the overview and its export', async () => {
      selectDespacho();
      void h.service.listEstates();
      expect(h.http.expectOne((r) => r.url === `${API}/estates`).request.params.get('administratorId')).toBe('d1');

      void h.service.getOverview(overviewQuery);
      expect(h.http.expectOne((r) => r.url === `${API}/estates/overview`).request.params.get('administratorId')).toBe('d1');

      void h.service.downloadOverviewExcel(overviewQuery);
      const exportReq = h.http.expectOne((r) => r.url.startsWith(`${API}/estates/overview/export.xlsx`));
      expect(new URL(exportReq.request.urlWithParams).searchParams.get('administratorId')).toBe('d1');
    });

    it('role A without a selected despacho sends no filter', () => {
      h.setCurrentUser(roleA);
      void h.service.listEstates();
      expect(h.http.expectOne((r) => r.url === `${API}/estates`).request.params.has('administratorId')).toBe(false);
    });

    it('role B never sends the filter (estate list, overview and export unchanged)', () => {
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'b1', id: 'd1', name: 'X' }));
      h.setCurrentUser(roleB);
      void h.service.listEstates();
      expect(h.http.expectOne((r) => r.url === `${API}/estates`).request.urlWithParams).toBe(`${API}/estates`);

      void h.service.getOverview(overviewQuery);
      expect(h.http.expectOne((r) => r.url === `${API}/estates/overview`).request.params.has('administratorId')).toBe(false);

      void h.service.downloadOverviewExcel(overviewQuery);
      const exportReq = h.http.expectOne((r) => r.url.startsWith(`${API}/estates/overview/export.xlsx`));
      expect(exportReq.request.url).toBe(`${API}/estates/overview/export.xlsx?search=&filter=all&types=&sort=name&direction=asc`);
    });

    it('setup summary: role A sends the selected despacho, and nothing without a selection', () => {
      selectDespacho();
      void h.service.getSetupSummary();
      expect(h.http.expectOne((r) => r.url === `${API}/estates/setup-summary`).request.params.get('administratorId')).toBe('d1');

      TestBed.inject(DespachoContextService).clear();
      void h.service.getSetupSummary();
      expect(h.http.expectOne((r) => r.url === `${API}/estates/setup-summary`).request.params.has('administratorId')).toBe(false);
    });

    it('setup summary: role B never sends the filter', () => {
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'b1', id: 'd1', name: 'X' }));
      h.setCurrentUser(roleB);
      void h.service.getSetupSummary();
      expect(h.http.expectOne((r) => r.url === `${API}/estates/setup-summary`).request.urlWithParams).toBe(`${API}/estates/setup-summary`);
    });
  });
});
