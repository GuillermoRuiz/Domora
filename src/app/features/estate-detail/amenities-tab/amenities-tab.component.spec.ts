import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { AmenitiesTabComponent } from './amenities-tab.component';
import type { Amenity, AmenityBlackout, Booking } from '../../../core/models';

function makeAmenity(overrides: Partial<Amenity> = {}): Amenity {
  return {
    id: 'am1', estateId: 'e1', name: 'Piscina', icon: '🏊', color: 'var(--color-accent)', bg: 'var(--color-bg)',
    maxHours: 2, slots: ['10:00', '11:00'], rules: '', capacity: 4, seasonal: false, active: true,
    ...overrides,
  };
}

function makeBlackout(overrides: Partial<AmenityBlackout> = {}): AmenityBlackout {
  return { id: 'bk1', amenityId: 'am1', startDate: '2026-06-01', endDate: '2026-06-10', reason: 'Limpieza', ...overrides };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', amenityId: 'am1', amenityName: 'Piscina', date: '2026-04-01', startSlot: '10:00', endSlot: '11:00',
    status: 'confirmed', createdAt: '2026-03-01', guests: 2, propertyLabel: 'Piso 1-2A', userName: 'Ana García',
    ...overrides,
  };
}


let h: ComponentHarness<AmenitiesTabComponent>;

describe('AmenitiesTabComponent', () => {
  beforeEach(() => {
    h = setupComponent(AmenitiesTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function openAmenities(amenities: Amenity[] = [makeAmenity()], bookings: Booking[] = []): Promise<void> {
    h.fixture.detectChanges(); // dispara ngOnInit
    h.http.expectOne((r) => r.url === `${API}/estates/e1/amenities`).flush(amenities);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/amenities/bookings`).flush(bookings);
    await settle();
    h.fixture.detectChanges();
  }

  it('al montarse carga instalaciones y reservas en paralelo', async () => {
    await openAmenities([makeAmenity({ id: 'am1', name: 'Piscina' })], [makeBooking()]);

    expect(h.component.amenitiesLoaded()).toBe(true);
    expect(h.el.querySelectorAll('.amenity-row')).toHaveLength(1);
    expect(h.el.querySelectorAll('.table tbody tr')).toHaveLength(1);
  });

  it('avisa al padre del nº de instalaciones (contador de la pestaña)', async () => {
    const counts: number[] = [];
    h.component.countChange.subscribe((n) => counts.push(n));
    await openAmenities([makeAmenity({ id: 'am1' }), makeAmenity({ id: 'am2' })]);
    expect(counts[counts.length - 1]).toBe(2);
  });

  describe('CRUD de instalación', () => {
    beforeEach(async () => {
      await openAmenities([makeAmenity({ id: 'am1' })]);
    });

    it('sin nombre ni franjas horarias, muestra errores y no llama a la API', async () => {
      h.component.openNuevaAmenidad();
      h.component.amSlots.set([]);
      h.fixture.detectChanges();

      await h.component.submitAmenidad();
      h.fixture.detectChanges();

      expect(h.component.amErrors().name).toBe(true);
      expect(h.component.amErrors().slots).toBe(true);
      h.http.expectNone((r) => r.method === 'POST' && r.url.includes('/amenities'));
    });

    it('maxHours/capacity inválidos (< 1) también fallan la validación', async () => {
      h.component.openNuevaAmenidad();
      h.component.amName.set('Gimnasio');
      h.component.toggleAmSlot('09:00');
      h.component.amMaxHours.set(0);
      h.component.amCapacity.set(0);

      await h.component.submitAmenidad();

      expect(h.component.amErrors().maxHours).toBe(true);
      expect(h.component.amErrors().capacity).toBe(true);
    });

    it('crear una instalación válida hace POST y la añade al listado', async () => {
      h.component.openNuevaAmenidad();
      h.component.amName.set('Gimnasio');
      h.component.toggleAmSlot('09:00');
      h.component.amMaxHours.set(1);
      h.component.amCapacity.set(10);

      const promise = h.component.submitAmenidad();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/amenities` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ name: 'Gimnasio', slots: ['09:00'], maxHours: 1, capacity: 10 });
      req.flush(makeAmenity({ id: 'am2', name: 'Gimnasio', slots: ['09:00'], maxHours: 1, capacity: 10 }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.amenities()).toHaveLength(2);
      expect(h.component.showNuevaAmenidad()).toBe(false);
    });

    it('editar una instalación existente hace PATCH sobre esa instalación', async () => {
      h.component.openEditAmenidad(h.component.amenities()[0]);
      expect(h.component.amName()).toBe('Piscina'); // precargado
      h.component.amName.set('Piscina climatizada');

      const promise = h.component.submitAmenidad();
      const req = h.http.expectOne((r) => r.url === `${API}/amenities/am1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ name: 'Piscina climatizada' });
      req.flush(makeAmenity({ id: 'am1', name: 'Piscina climatizada' }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.amenities()[0].name).toBe('Piscina climatizada');
    });

    it('activar/desactivar hace PATCH con el estado invertido', async () => {
      const promise = h.component.toggleAmenityActive(h.component.amenities()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/amenities/am1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ active: false });
      req.flush(makeAmenity({ id: 'am1', active: false }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.amenities()[0].active).toBe(false);
      expect(h.el.querySelector('.toast')?.textContent).toContain('desactivada');
    });
  });

  describe('periodos de mantenimiento (blackouts)', () => {
    beforeEach(async () => {
      await openAmenities([makeAmenity({ id: 'am1' })]);
    });

    it('expandir carga los bloqueos; volver a expandir (tras colapsar) NO repite la llamada', async () => {
      const promise = h.component.toggleAmenityExpanded('am1');
      h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts`).flush([makeBlackout()]);
      await promise;
      h.fixture.detectChanges();
      expect(h.component.blackoutsFor('am1')).toHaveLength(1);

      await h.component.toggleAmenityExpanded('am1'); // colapsa, sin HTTP
      expect(h.component.expandedAmenityId()).toBeNull();

      await h.component.toggleAmenityExpanded('am1'); // reexpande — cache ya poblada
      h.http.expectNone((r) => r.url === `${API}/amenities/am1/blackouts`);
      expect(h.component.blackoutsFor('am1')).toHaveLength(1);
    });

    it('un rango con fin anterior al inicio se rechaza sin llamar a la API', async () => {
      h.component.openNuevoBloqueo(h.component.amenities()[0]);
      h.component.bkStartDate.set('2026-06-10');
      h.component.bkEndDate.set('2026-06-05');

      await h.component.submitBloqueo();

      expect(h.component.bkErrors().dates).toBe(true);
      h.http.expectNone((r) => r.url.includes('/blackouts') && r.method === 'POST');
    });

    it('un rango válido crea el bloqueo y lo añade a la lista de esa instalación', async () => {
      // primero expande para poblar la cache en [] y poder verlo crecer
      const expandPromise = h.component.toggleAmenityExpanded('am1');
      h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts`).flush([]);
      await expandPromise;

      h.component.openNuevoBloqueo(h.component.amenities()[0]);
      h.component.bkStartDate.set('2026-06-01');
      h.component.bkEndDate.set('2026-06-10');
      h.component.bkReason.set('Mantenimiento anual');

      const promise = h.component.submitBloqueo();
      const req = h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts` && r.method === 'POST');
      expect(req.request.body).toEqual({ startDate: '2026-06-01', endDate: '2026-06-10', reason: 'Mantenimiento anual' });
      req.flush(makeBlackout());
      await promise;
      h.fixture.detectChanges();

      expect(h.component.blackoutsFor('am1')).toHaveLength(1);
      expect(h.component.showNuevoBloqueo()).toBe(false);
    });

    it('eliminar un bloqueo pide confirmación y, si se acepta, hace DELETE', async () => {
      const expandPromise = h.component.toggleAmenityExpanded('am1');
      h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts`).flush([makeBlackout({ id: 'bk1' })]);
      await expandPromise;
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const promise = h.component.deleteBloqueo('am1', 'bk1');
      h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts/bk1` && r.method === 'DELETE').flush(null);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.blackoutsFor('am1')).toHaveLength(0);
    });

    it('si se cancela la confirmación, no elimina el bloqueo', async () => {
      const expandPromise = h.component.toggleAmenityExpanded('am1');
      h.http.expectOne((r) => r.url === `${API}/amenities/am1/blackouts`).flush([makeBlackout({ id: 'bk1' })]);
      await expandPromise;
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      await h.component.deleteBloqueo('am1', 'bk1');

      expect(h.component.blackoutsFor('am1')).toHaveLength(1);
      h.http.expectNone((r) => r.method === 'DELETE');
    });
  });

  describe('reservas de la finca', () => {
    it('cancelar una reserva pide confirmación y, si se acepta, hace PATCH /cancel', async () => {
      await openAmenities([makeAmenity()], [makeBooking({ id: 'b1' })]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const promise = h.component.cancelEstateBooking(h.component.estateBookings()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/bookings/b1/cancel` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ reason: 'Cancelada por la administración' });
      req.flush(null);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.estateBookings()).toHaveLength(0);
    });

    it('si se cancela la confirmación, la reserva sigue en la lista', async () => {
      await openAmenities([makeAmenity()], [makeBooking({ id: 'b1' })]);
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      await h.component.cancelEstateBooking(h.component.estateBookings()[0]);

      expect(h.component.estateBookings()).toHaveLength(1);
      h.http.expectNone((r) => r.method === 'PATCH');
    });
  });
});

