import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { AmenitiesService } from './amenities.service';

describe('AmenitiesService', () => {
  let h: ApiServiceHarness<AmenitiesService>;

  beforeEach(() => {
    h = setupApiService(AmenitiesService);
  });

  afterEach(() => h.http.verify());

  describe('Amenities', () => {
    it('listAmenitiesByEstate — GET simple', async () => {
      const promise = h.service.listAmenitiesByEstate('e1');
      h.http.expectOne(`${API}/estates/e1/amenities`).flush([{ id: 'am1', estateId: 'e1', name: 'Piscina', icon: 'pool', color: '#000', bg: '#fff', maxHours: 2, slots: ['10:00'], rules: '', capacity: 20 }]);
      expect((await promise)[0].name).toBe('Piscina');
    });

    it('createAmenity manda el input tal cual', async () => {
      const input = { name: 'Gimnasio', maxHours: 1, slots: ['08:00'], capacity: 10 };
      const promise = h.service.createAmenity('e1', input);
      const req = h.http.expectOne(`${API}/estates/e1/amenities`);
      expect(req.request.body).toEqual(input);
      req.flush({ id: 'am2', estateId: 'e1', name: 'Gimnasio', icon: '', color: '', bg: '', maxHours: 1, slots: ['08:00'], rules: '', capacity: 10 });
      expect((await promise).name).toBe('Gimnasio');
    });

    it('updateAmenity — PATCH parcial', async () => {
      const promise = h.service.updateAmenity('am1', { active: false });
      const req = h.http.expectOne(`${API}/amenities/am1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ active: false });
      req.flush({ id: 'am1', estateId: 'e1', name: 'x', icon: '', color: '', bg: '', maxHours: 1, slots: [], rules: '', capacity: 1 });
      await promise;
    });

    it('listAmenityBlackouts / createAmenityBlackout / deleteAmenityBlackout', async () => {
      const listPromise = h.service.listAmenityBlackouts('am1');
      h.http.expectOne(`${API}/amenities/am1/blackouts`).flush([{ id: 'b1', amenityId: 'am1', startDate: '2026-08-01', endDate: '2026-08-15' }]);
      expect((await listPromise)).toHaveLength(1);

      const createPromise = h.service.createAmenityBlackout('am1', { startDate: '2026-08-01', endDate: '2026-08-15', reason: 'Mantenimiento' });
      const createReq = h.http.expectOne(`${API}/amenities/am1/blackouts`);
      expect(createReq.request.body).toEqual({ startDate: '2026-08-01', endDate: '2026-08-15', reason: 'Mantenimiento' });
      createReq.flush({ id: 'b1', amenityId: 'am1', startDate: '2026-08-01', endDate: '2026-08-15', reason: 'Mantenimiento' });
      await createPromise;

      const deletePromise = h.service.deleteAmenityBlackout('am1', 'b1');
      const deleteReq = h.http.expectOne(`${API}/amenities/am1/blackouts/b1`);
      expect(deleteReq.request.method).toBe('DELETE');
      deleteReq.flush(null);
      await deletePromise;
    });

    it('amenityAvailability pasa la fecha como query param', async () => {
      const promise = h.service.amenityAvailability('am1', '2026-08-10');
      const req = h.http.expectOne((r) => r.url === `${API}/amenities/am1/availability` && r.params.get('date') === '2026-08-10');
      req.flush({ amenityId: 'am1', date: '2026-08-10', slots: ['10:00'], occupied: [], blocked: false });
      expect((await promise).blocked).toBe(false);
    });
  });

  describe('Bookings', () => {
    it('listMyBookings normaliza la fecha', async () => {
      const promise = h.service.listMyBookings();
      h.http.expectOne(`${API}/bookings`).flush([{ id: 'bk1', amenityId: 'am1', amenityName: 'Piscina', date: '2026-08-10T00:00:00.000Z', startSlot: '10:00', endSlot: '11:00', status: 'confirmed', createdAt: '2026-08-01', guests: 2 }]);
      expect((await promise)[0].date).toBe('2026-08-10');
    });

    it('listBookingsForEstate resuelve amenityName/propertyLabel/userName desde los objetos embebidos', async () => {
      const promise = h.service.listBookingsForEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/amenities/bookings`);
      req.flush([{
        id: 'bk1', amenityId: 'am1', date: '2026-08-10', startSlot: '10:00', endSlot: '11:00', status: 'confirmed', createdAt: '2026-08-01', guests: 1,
        amenity: { name: 'Piscina' }, property: { type: 'Piso', ref: '1A' }, user: { fullName: 'Ana' },
      }]);
      const [b] = await promise;
      expect(b.amenityName).toBe('Piscina');
      expect(b.propertyLabel).toBe('Piso 1A');
      expect((b as unknown as { userName?: string }).userName).toBe('Ana');
    });

    it('listBookingsForEstate sin propiedad embebida, propertyLabel queda undefined', async () => {
      const promise = h.service.listBookingsForEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/amenities/bookings`);
      req.flush([{ id: 'bk1', amenityId: 'am1', date: '2026-08-10', startSlot: '10:00', endSlot: '11:00', status: 'confirmed', createdAt: '2026-08-01', guests: 1 }]);
      expect((await promise)[0].propertyLabel).toBeUndefined();
    });

    it('createBooking manda el input tal cual', async () => {
      const input = { amenityId: 'am1', date: '2026-08-10', startSlot: '10:00', endSlot: '11:00' };
      const promise = h.service.createBooking(input);
      const req = h.http.expectOne(`${API}/bookings`);
      expect(req.request.body).toEqual(input);
      req.flush({ id: 'bk1', amenityId: 'am1', amenityName: 'Piscina', date: '2026-08-10', startSlot: '10:00', endSlot: '11:00', status: 'confirmed', createdAt: '2026-08-01', guests: 1 });
      await promise;
    });

    it('cancelBooking manda el motivo', async () => {
      const promise = h.service.cancelBooking('bk1', 'Cambio de planes');
      const req = h.http.expectOne(`${API}/bookings/bk1/cancel`);
      expect(req.request.body).toEqual({ reason: 'Cambio de planes' });
      req.flush(null);
      await promise;
    });
  });

});
