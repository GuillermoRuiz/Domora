import { API, makeUser, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { PropertiesService } from './properties.service';

describe('PropertiesService', () => {
  let h: ApiServiceHarness<PropertiesService>;

  beforeEach(() => {
    h = setupApiService(PropertiesService);
  });

  afterEach(() => h.http.verify());

  describe('formatPostalAddress (helper puro)', () => {
    it('sin viaType ni viaName, devuelve cadena vacía', () => {
      expect(h.service.formatPostalAddress({} as never)).toBe('');
    });

    it('solo viaType+viaName, sin número ni unidad', () => {
      expect(h.service.formatPostalAddress({ viaType: 'Calle', viaName: 'Mayor' } as never)).toBe('Calle Mayor');
    });

    it('con número, lo añade tras una coma', () => {
      expect(h.service.formatPostalAddress({ viaType: 'Calle', viaName: 'Mayor', streetNumber: '12' } as never)).toBe('Calle Mayor, 12');
    });

    it('el sufijo de número se pega directo al número, sin separador', () => {
      expect(h.service.formatPostalAddress({ viaType: 'Calle', viaName: 'Mayor', streetNumber: '12', streetNumberSuffix: 'bis' } as never)).toBe('Calle Mayor, 12bis');
    });

    it('con escalera/piso/puerta, arma la unidad separada por espacios tras una coma', () => {
      const result = h.service.formatPostalAddress({
        viaType: 'Calle', viaName: 'Mayor', streetNumber: '12', staircase: '1', floor: '2', door: 'A',
      } as never);
      expect(result).toBe('Calle Mayor, 12, esc. 1 2º A');
    });

    it('unidad con solo puerta (sin escalera ni piso)', () => {
      const result = h.service.formatPostalAddress({ viaType: 'Calle', viaName: 'Mayor', door: 'A' } as never);
      expect(result).toBe('Calle Mayor, A');
    });

    it('solo viaName sin viaType, no antepone espacio extra', () => {
      expect(h.service.formatPostalAddress({ viaName: 'Mayor' } as never)).toBe('Mayor');
    });
  });

  describe('resolvePropertyView', () => {
    it('conserva los datos de contacto del administrador embebido', async () => {
      const promise = h.service.resolvePropertyView('p1', 'viewer1');
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1/view` && r.params.get('viewerUserId') === 'viewer1');
      req.flush({
        property: { id: 'p1' }, estate: null,
        admin: { id: 'a1', name: 'Gestora', phone: '600000000', contactName: 'Ana', contactEmail: 'ana@gestora.test' },
        adminContact: null, membership: null, estateName: null, adminName: 'Gestora', adminContactName: null,
        nickname: 'Mi piso', viewerRoleType: 'Propietario', isLinked: true, linkageStatus: 'linked', addressFull: '',
      });
      const view = await promise;
      expect(view?.admin).toEqual({ id: 'a1', name: 'Gestora', phone: '600000000', contactName: 'Ana', contactEmail: 'ana@gestora.test' });
    });

    it('admin ausente (null) se propaga como null, no como objeto vacío mapeado', async () => {
      const promise = h.service.resolvePropertyView('p1');
      const req = h.http.expectOne(`${API}/properties/p1/view`);
      req.flush({ property: { id: 'p1' }, estate: null, admin: null, adminContact: null, membership: null, estateName: null, adminName: null, adminContactName: null, nickname: '', viewerRoleType: 'Propietario', isLinked: false, linkageStatus: 'none', addressFull: '' });
      expect((await promise)?.admin).toBeNull();
    });

    it('devuelve null si la petición falla', async () => {
      const promise = h.service.resolvePropertyView('no-existe');
      const req = h.http.expectOne(`${API}/properties/no-existe/view`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });

    it('respuesta null (sin error HTTP) también devuelve null', async () => {
      const promise = h.service.resolvePropertyView('p-vacia');
      const req = h.http.expectOne(`${API}/properties/p-vacia/view`);
      req.flush(null as never);
      expect(await promise).toBeNull();
    });
  });

  describe('listOwnerProperties', () => {
    it('sin usuario en sesión, devuelve [] sin llamar a la API', async () => {
      h.setCurrentUser(null);
      const result = await h.service.listOwnerProperties();
      expect(result).toEqual([]);
      h.http.expectNone(() => true);
    });

    it('deriva las propiedades de las membresías del usuario, deduplicando por id', async () => {
      h.setCurrentUser(makeUser({ id: 'owner1' }));
      const promise = h.service.listOwnerProperties();
      const req = h.http.expectOne(`${API}/users/owner1/memberships`);
      req.flush([
        { id: 'm1', property: { id: 'p1', type: 'Piso' } },
        { id: 'm2', property: { id: 'p1', type: 'Piso' } }, // misma propiedad, dos membresías (p.ej. cotitular)
        { id: 'm3', property: { id: 'p2', type: 'Garaje' } },
        { id: 'm4', property: null }, // membresía sin propiedad embebida — se ignora
      ]);
      const result = await promise;
      expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
    });
  });

  describe('listPropertiesByEstate', () => {
    it('ordena por escalera-planta-puerta', async () => {
      const promise = h.service.listPropertiesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      req.flush([
        { id: 'p3', staircase: '2', floor: '1', door: 'A' },
        { id: 'p1', staircase: '1', floor: '1', door: 'A' },
        { id: 'p2', staircase: '1', floor: '2', door: 'A' },
      ]);
      const result = await promise;
      expect(result.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('trata escalera/planta/puerta ausentes como cadena vacía al ordenar, sin lanzar', async () => {
      const promise = h.service.listPropertiesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      req.flush([{ id: 'p1' }, { id: 'p2', staircase: '1' }]);
      const result = await promise;
      expect(result).toHaveLength(2);
    });
  });

  describe('coeficiente de participación — la API lo serializa como string (Decimal)', () => {
    it('listPropertiesByEstate lo normaliza a número, y deja null como null', async () => {
      const promise = h.service.listPropertiesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      req.flush([
        { id: 'p1', staircase: '1', participationQuota: '2.50' },
        { id: 'p2', staircase: '2', participationQuota: null },
        { id: 'p3', staircase: '3', participationQuota: '0.00' },
      ]);
      const result = await promise;
      expect(result.map((p) => p.participationQuota)).toEqual([2.5, null, 0]);
    });

    it('la superficie construida del Catastro (Decimal) también se normaliza a número', async () => {
      const promise = h.service.listPropertiesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      req.flush([
        { id: 'p1', staircase: '1', builtAreaM2: '85.50', participationQuota: '2.15' },
        { id: 'p2', staircase: '2', builtAreaM2: null },
      ]);
      const result = await promise;
      expect(result.map((p) => p.builtAreaM2)).toEqual([85.5, null]);
      expect(result[0].participationQuota).toBe(2.15);
      expect('participationQuota' in result[1]).toBe(false);
    });

    it('si la respuesta no trae la clave, no se inventa (no aparece como null)', async () => {
      const promise = h.service.listPropertiesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      req.flush([{ id: 'p1' }]);
      const [property] = await promise;
      expect('participationQuota' in property).toBe(false);
    });

    it('findOwnerPropertyById lo normaliza también', async () => {
      const promise = h.service.findOwnerPropertyById('p1');
      const req = h.http.expectOne(`${API}/properties/p1`);
      req.flush({ id: 'p1', participationQuota: '12.75' });
      expect((await promise)?.participationQuota).toBe(12.75);
    });

    it('listOwnerProperties (vía membresías) lo normaliza también', async () => {
      h.setCurrentUser(makeUser({ id: 'owner1' }));
      const promise = h.service.listOwnerProperties();
      const req = h.http.expectOne(`${API}/users/owner1/memberships`);
      req.flush([{ id: 'm1', property: { id: 'p1', participationQuota: '3.10' } }]);
      expect((await promise)[0].participationQuota).toBe(3.1);
    });
  });

  describe('findOwnerPropertyById / findPropertyById', () => {
    it('findPropertyById es un alias de findOwnerPropertyById', async () => {
      const promise = h.service.findPropertyById('p1');
      const req = h.http.expectOne(`${API}/properties/p1`);
      req.flush({ id: 'p1', type: 'Piso' });
      expect((await promise)?.id).toBe('p1');
    });

    it('devuelve null si falla', async () => {
      const promise = h.service.findOwnerPropertyById('no-existe');
      const req = h.http.expectOne(`${API}/properties/no-existe`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });
  });

  describe('mutaciones de propiedad', () => {
    it('createOwnerProperty manda el payload de alta (rol C) tal cual', async () => {
      const promise = h.service.createOwnerProperty({ type: 'Piso', roleType: 'Propietario' });
      const req = h.http.expectOne(`${API}/properties`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ type: 'Piso', roleType: 'Propietario' });
      req.flush({ id: 'p1', type: 'Piso' });
      expect((await promise).id).toBe('p1');
    });

    it('updateOwnerProperty — PATCH con el patch tal cual', async () => {
      const promise = h.service.updateOwnerProperty('p1', { floor: '3' });
      const req = h.http.expectOne(`${API}/properties/p1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ floor: '3' });
      req.flush({ id: 'p1', floor: '3' });
      await promise;
    });

    it('createEstateProperty — alta directa dentro de una finca gestionada', async () => {
      const promise = h.service.createEstateProperty('e1', { type: 'Trastero' });
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'p1', type: 'Trastero' });
      expect((await promise).type).toBe('Trastero');
    });

    it('createEstateProperty manda el coeficiente de participación', async () => {
      const promise = h.service.createEstateProperty('e1', { type: 'Piso', participationQuota: 2.5 });
      const req = h.http.expectOne(`${API}/estates/e1/properties`);
      expect(req.request.body).toEqual({ type: 'Piso', participationQuota: 2.5 });
      req.flush({ id: 'p1', type: 'Piso', participationQuota: '2.50' });
      expect((await promise).participationQuota).toBe(2.5);
    });

    it('updateOwnerProperty puede mandar null para borrar el coeficiente, y lo devuelve normalizado', async () => {
      const promise = h.service.updateOwnerProperty('p1', { participationQuota: null });
      const req = h.http.expectOne(`${API}/properties/p1`);
      expect(req.request.body).toEqual({ participationQuota: null });
      req.flush({ id: 'p1', participationQuota: null });
      expect((await promise).participationQuota).toBeNull();
    });

    it('deleteOwnerProperty — DELETE', async () => {
      const promise = h.service.deleteOwnerProperty('p1');
      const req = h.http.expectOne(`${API}/properties/p1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await promise;
    });
  });

  describe('estate onboarding requests', () => {
    it('createEstateOnboardingRequest manda el payload', async () => {
      const promise = h.service.createEstateOnboardingRequest({ communityName: 'Comunidad Nueva' });
      const req = h.http.expectOne(`${API}/estate-onboarding-requests`);
      expect(req.request.method).toBe('POST');
      req.flush(null);
      await promise;
    });

    it('listEstateOnboardingRequests mapea el solicitante con fallback "—"', async () => {
      const promise = h.service.listEstateOnboardingRequests();
      const req = h.http.expectOne(`${API}/estate-onboarding-requests`);
      req.flush([
        { id: 'r1', communityName: 'A', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', requestedByUser: { fullName: 'Ana', email: 'ana@x.com' } },
        { id: 'r2', communityName: 'B', status: 'pending', createdAt: '2026-01-02T00:00:00.000Z' }, // sin requestedByUser
      ]);
      const [withUser, withoutUser] = await promise;
      expect(withUser.requestedByName).toBe('Ana');
      expect(withoutUser.requestedByName).toBe('—');
      expect(withoutUser.requestedByEmail).toBe('—');
    });

    it('resolveEstateOnboardingRequest — PATCH con el nuevo status', async () => {
      const promise = h.service.resolveEstateOnboardingRequest('r1', 'contacted');
      const req = h.http.expectOne(`${API}/estate-onboarding-requests/r1`);
      expect(req.request.body).toEqual({ status: 'contacted' });
      req.flush(null);
      await promise;
    });
  });

  describe('External owners', () => {
    it('findExternalOwner siempre devuelve null (sin endpoint por propertyId todavía)', async () => {
      expect(await h.service.findExternalOwner('p1')).toBeNull();
      h.http.expectNone(() => true);
    });

    it('createExternalOwner — POST a la propiedad con los datos del titular', async () => {
      const promise = h.service.createExternalOwner('p1', { fullName: 'Ana Titular', email: 'ana@example.com' });
      const req = h.http.expectOne(`${API}/properties/p1/external-owners`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ fullName: 'Ana Titular', email: 'ana@example.com' });
      req.flush({ id: 'eo1', propertyId: 'p1', fullName: 'Ana Titular' });
      expect((await promise).id).toBe('eo1');
    });

    it('listExternalOwnersByEstate — GET simple', async () => {
      const promise = h.service.listExternalOwnersByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/external-owners`);
      req.flush([{ id: 'x1', propertyId: 'p1', fullName: 'Titular Externo', createdAt: '2026-01-01', createdByUserId: 'u1' }]);
      expect((await promise)[0].fullName).toBe('Titular Externo');
    });
  });
});
