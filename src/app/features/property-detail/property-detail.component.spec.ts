import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import type { HttpTestingController } from '@angular/common/http/testing';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, setupComponent, settle, makeUser, type ComponentHarness } from '../../core/testing/component-harness';
import { PropertyDetailComponent } from './property-detail.component';
import { StateService } from '../../core/state.service';
import type {
  OwnerProperty, PropertyView, Amenity, Booking, Communication,
  StaffDirectoryEntry, Estate, User,
} from '../../core/models';
import type { AuthenticatedUser } from '../../core/auth.service';

registerLocaleData(localeEs);

// ── Fábricas ────────────────────────────────────────────────────────────

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return {
    id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado',
    quotaMonthly: 120, balance: 0, pendingDocs: 0, openIssues: 0,
    municipality: 'Madrid', province: 'Madrid',
    ...overrides,
  };
}

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    address: 'Calle Mayor 1', location: 'Madrid', properties: 10, residents: 20,
    requests: 0, activeIssues: 0, occupancy: 90, reserveTarget: 1000,
    iban: 'ES1234567890123456789012',
    ...overrides,
  } as Estate;
}

function makePropertyView(overrides: Partial<PropertyView> = {}): PropertyView {
  return {
    property: makeProperty(),
    estate: makeEstate(),
    admin: null,
    adminContact: null,
    membership: null,
    estateName: 'Edificio Sol',
    adminName: 'Gestora Sol S.L.',
    adminContactName: 'Marta Admin',
    nickname: 'Mi piso',
    viewerRoleType: 'Propietario',
    isLinked: true,
    linkageStatus: 'linked',
    addressFull: 'Calle Mayor 1, 2ºA',
    ...overrides,
  };
}

function makeAmenity(overrides: Partial<Amenity> = {}): Amenity {
  return {
    id: 'am1', estateId: 'e1', name: 'Piscina', icon: '🏊', color: '#003366', bg: '#e0f0ff',
    maxHours: 2, slots: ['09:00', '10:00', '11:00', '12:00'], rules: 'Uso máximo 2h seguidas.',
    capacity: 6, active: true,
    ...overrides,
  };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', amenityId: 'am1', amenityName: 'Piscina', date: '2026-06-20',
    startSlot: '10:00', endSlot: '11:00', status: 'confirmed', createdAt: '2026-06-01',
    guests: 2,
    ...overrides,
  };
}

function makeCommunication(overrides: Partial<Communication & { read: boolean }> = {}): Communication & { read: boolean } {
  return {
    id: 'c1', estateId: 'e1', title: 'Junta anual', body: 'Convocatoria de junta anual', date: '2026-06-01',
    from: 'Administración', authorUserId: 'admin-1', archived: false, read: false,
    category: 'General', isLegalNotice: false, replies: [], attachments: [],
    ...overrides,
  };
}

function makeStaff(overrides: Partial<StaffDirectoryEntry> = {}): StaffDirectoryEntry {
  return { id: 's1', fullName: 'Pedro Portero', position: 'Conserje', phone: '600111222', email: 'pedro@x.com', schedule: 'L-V 8-15h', ...overrides };
}

const PINNED_NOW = '2026-06-15T12:00:00Z';

/** Arma el harness con una ActivatedRoute controlada y fija "hoy" a 2026-06-15 (coincide con el mes/año por defecto del mini-calendario). */
function setup(opts: { id?: string | null; query?: Record<string, string>; user?: AuthenticatedUser | null } = {}): ComponentHarness<PropertyDetailComponent> {
  vi.setSystemTime(new Date(PINNED_NOW));
  const id = opts.id === undefined ? 'p1' : opts.id;
  const providers = [{
    provide: ActivatedRoute,
    useValue: {
      snapshot: {
        paramMap: convertToParamMap(id ? { id } : {}),
        queryParamMap: convertToParamMap(opts.query ?? {}),
      },
    },
  }];
  return setupComponent(PropertyDetailComponent, { user: opts.user === undefined ? makeUser({ id: 'u1' }) : opts.user, providers });
}

interface LoadOpts {
  id?: string;
  userId?: string;
  property?: OwnerProperty | null;
  view?: PropertyView | null;
  bookings?: Booking[];
  amenities?: Amenity[];
  communications?: { items: (Communication & { read: boolean })[]; total: number; page: number; pageSize: number };
  staff?: StaffDirectoryEntry[];
}

/**
 * Flushea la secuencia de `ngOnInit`: primero property+view en paralelo,
 * luego las reservas del usuario, y SOLO si hay estateId
 * resuelto, un tercer Promise.all con amenities+comunicados+personal.
 * Cada eslabón necesita su propio `await settle()` — `firstValueFrom` resuelve
 * en un microtask tras el `.flush()`, así que el siguiente grupo de requests
 * no existe todavía si no se deja pasar ese tick.
 */
async function flushInitialLoad(http: HttpTestingController, opts: LoadOpts = {}): Promise<void> {
  const id = opts.id ?? 'p1';
  const property = opts.property === undefined ? makeProperty() : opts.property;
  const view = opts.view === undefined ? makePropertyView() : opts.view;

  http.expectOne((r) => r.url === `${API}/properties/${id}`).flush(property);
  http.expectOne((r) => r.url === `${API}/properties/${id}/view`).flush(view);
  await settle();

  http.expectOne((r) => r.url === `${API}/bookings`).flush(opts.bookings ?? []);
  await settle();

  const estateId = property?.estateId ?? view?.estate?.id ?? null;
  if (estateId) {
    http.expectOne((r) => r.url === `${API}/estates/${estateId}/amenities`).flush(opts.amenities ?? [makeAmenity()]);
    http.expectOne((r) => r.url === `${API}/estates/${estateId}/communications`).flush(opts.communications ?? { items: [], total: 0, page: 1, pageSize: 20 });
    http.expectOne((r) => r.url === `${API}/estates/${estateId}/staff/directory`).flush(opts.staff ?? []);
    await settle();
  }
}

function tabButton(el: HTMLElement, label: string): HTMLElement {
  const btn = Array.from(el.querySelectorAll('.tab')).find((b) => b.textContent?.includes(label)) as HTMLElement | undefined;
  if (!btn) throw new Error(`tab "${label}" no encontrada`);
  return btn;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s/g, ' ');
}

/**
 * `verify()`, pero antes drena cualquier GET `.../memberships` todavía
 * pendiente. `MembersSectionComponent` (pestaña "summary") dispara su propia
 * carga en cuanto se monta — el momento exacto depende de cuándo cada test
 * llama a `detectChanges()` después de `flushInitialLoad`, así que no hay un
 * único punto en `flushInitialLoad` donde vaya a existir siempre; se
 * intercepta acá, en el único lugar por el que pasan todos los tests.
 */
function drainAndVerify(http: HttpTestingController): void {
  http.match((r) => /\/properties\/[^/]+\/memberships$/.test(r.url)).forEach((req) => req.flush([]));
  http.verify();
}

describe('PropertyDetailComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Carga inicial ───────────────────────────────────────────────────
  describe('carga inicial', () => {
    it('sin :id de ruta ni propiedad seleccionada en el estado, no hace ninguna petición', async () => {
      const h = setup({ id: null });
      h.fixture.detectChanges();
      await settle();

      expect(h.component.property).toBeNull();
      drainAndVerify(h.http);
    });

    it('sin :id de ruta, usa la propiedad seleccionada en el estado global', async () => {
      const h = setup({ id: null });
      TestBed.inject(StateService).selectedProperty.set(makeProperty({ id: 'p2', estateId: null }));
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { id: 'p2', property: makeProperty({ id: 'p2', estateId: null }), view: null });
      h.fixture.detectChanges();

      expect(h.component.property?.id).toBe('p2');
      drainAndVerify(h.http);
    });

    it('con estateId resuelto, carga reservas y además amenities/comunicados/personal', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, {
        bookings: [makeBooking()],
        amenities: [makeAmenity()],
        communications: { items: [makeCommunication()], total: 1, page: 1, pageSize: 20 },
        staff: [makeStaff()],
      });
      h.fixture.detectChanges();

      expect(h.component.bookings()).toHaveLength(1);
      expect(h.component.amenities()).toHaveLength(1);
      expect(h.component.communications()).toHaveLength(1);
      expect(h.component.staffDirectory()).toHaveLength(1);
      expect(h.component.tabs().map((t) => t.id)).toContain('reservas');
      drainAndVerify(h.http);
    });

    it('sin estateId asociado, NO carga amenities/comunicados/personal y la pestaña Reservas no aparece', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, {
        property: makeProperty({ estateId: null }),
        view: null,
      });
      h.fixture.detectChanges();

      expect(h.component.amenities()).toHaveLength(0);
      expect(h.component.communications()).toHaveLength(0);
      expect(h.component.staffDirectory()).toHaveLength(0);
      expect(h.component.tabs().map((t) => t.id)).not.toContain('reservas');
      h.http.expectNone((r) => r.url.includes('/estates/'));
      drainAndVerify(h.http);
    });

    it('la ficha ya no tiene pestañas de Recibos ni Juntas ni pide los recibos (tienen su propio módulo)', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.tabs().map((t) => t.id)).toEqual(['summary', 'communications', 'reservas']);
      expect(h.el.querySelector('app-juntas-section')).toBeNull();
      expect(h.el.querySelector('.reports-card')).toBeNull();
      h.http.expectNone((r) => r.url.endsWith('/receipts'));
      drainAndVerify(h.http);
    });

    it('las reservas se filtran a las de las instalaciones de la finca vinculada', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, {
        amenities: [makeAmenity({ id: 'am1' })],
        bookings: [makeBooking({ id: 'b-mia', amenityId: 'am1' }), makeBooking({ id: 'b-otra-instalacion', amenityId: 'am-otra' })],
      });
      h.fixture.detectChanges();

      expect(h.component.bookings().map((b) => b.id)).toEqual(['b-mia']);
      drainAndVerify(h.http);
    });

    it('?tab= abre directamente esa pestaña', async () => {
      const h = setup({ query: { tab: 'communications' } });
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('communications');
      drainAndVerify(h.http);
    });

    it('?tab=reservas sin instalaciones comunes (no hay pestaña) se queda en resumen', async () => {
      const h = setup({ query: { tab: 'reservas' } });
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { amenities: [] });
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('summary');
      drainAndVerify(h.http);
    });

    it('un ?tab= inválido se ignora y se queda en resumen', async () => {
      const h = setup({ query: { tab: 'no-existe' } });
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('summary');
      drainAndVerify(h.http);
    });

    it('la ficha ya no tiene pestaña de Incidencias ni pide las incidencias de la propiedad', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.tabs().map((t) => t.id)).not.toContain('issues');
      expect(Array.from(h.el.querySelectorAll('.tab')).some((t) => t.textContent?.includes('Incidencias'))).toBe(false);
      expect(h.el.querySelector('.inc-card, .inc-stat')).toBeNull();
      h.http.expectNone((r) => r.url.includes('/issues'));
      drainAndVerify(h.http);
    });
  });

  describe('resumen', () => {
    it('muestra saldo, cuota mensual y datos del inmueble', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: -50, quotaMonthly: 120 }) });
      h.fixture.detectChanges();

      const cards = h.el.querySelectorAll('.summary-card__value');
      expect(norm(cards[0]?.textContent)).toContain('50,00');
      expect(norm(cards[1]?.textContent)).toContain('120,00');
      expect(h.el.textContent).toContain('Piso');
      expect(h.el.textContent).toContain('Edificio Sol');
      expect(h.el.textContent).toContain('Gestora Sol S.L.');
      drainAndVerify(h.http);
    });

    it('con saldo negativo, muestra la tarjeta de pago pendiente y "Pagar ahora" abre el modal de transferencia', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: -75 }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.sidebar-card--warning')).not.toBeNull();
      (h.el.querySelector('.sidebar-card--warning .action-btn') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.payTarget()).toEqual({ amount: 75, concept: 'Saldo pendiente' });
      expect(h.el.querySelector('app-transfer-instructions-modal')).not.toBeNull();
      drainAndVerify(h.http);
    });

    it('"Ver recibos y pagos" abre el módulo de Recibos en esta propiedad', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: -75 }) });
      h.fixture.detectChanges();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      (h.el.querySelector('[data-action="open-receipts"]') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(['/c/recibos'], { queryParams: { propertyId: 'p1' } });
      drainAndVerify(h.http);
    });

    it('con saldo al día, no muestra la tarjeta de pago pendiente', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: 0 }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.sidebar-card--warning')).toBeNull();
      drainAndVerify(h.http);
    });

    it('con deuda Y anticipo a la vez, avisa que no se descuentan entre sí', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: -75, advance: 30 }) });
      h.fixture.detectChanges();

      // El saldo pendiente de la tarjeta sigue siendo 75€, no 45€.
      expect(norm(h.el.querySelector('.sidebar-card--warning .sidebar-card__amount')?.textContent)).toContain('75,00');
      const note = h.el.querySelector('.advance-note');
      expect(note?.textContent).toContain('30');
      expect(note?.textContent).toContain('No se descuenta');
      drainAndVerify(h.http);
    });

    it('sin deuda pero con anticipo, avisa igual (dinero a favor a la espera de aplicarse)', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: 0, advance: 20 }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.sidebar-card--warning')).toBeNull();
      const note = h.el.querySelector('.advance-note');
      expect(note?.textContent).toContain('20');
      expect(note?.textContent).toContain('próxima cuota');
      drainAndVerify(h.http);
    });

    it('sin anticipo, no muestra el aviso', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ balance: -75 }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.advance-note')).toBeNull();
      drainAndVerify(h.http);
    });

    it('muestra el próximo evento cuando la propiedad tiene uno', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, {
        property: makeProperty({ nextEvent: { title: 'Junta ordinaria', date: '2026-07-01', day: '1', month: 'Jul', location: 'Sala común', room: '', time: '19:00' } }),
      });
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Junta ordinaria');
      expect(h.el.textContent).toContain('Sala común');
      drainAndVerify(h.http);
    });

    it('lista el personal de la finca cuando existe directorio', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { staff: [makeStaff({ fullName: 'Pedro Portero', position: 'Conserje' })] });
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Pedro Portero');
      expect(h.el.textContent).toContain('Conserje');
      drainAndVerify(h.http);
    });

    it('contactAdmin navega a mensajes con el id del contacto del admin cuando existe', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ adminContact: { id: 'admin-user-1' } as User }) });
      h.fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      (h.el.querySelector('.admin-row + .action-btn, .sidebar-card .action-btn') as HTMLElement)?.click();
      h.component.contactAdmin();

      expect(navSpy).toHaveBeenCalledWith(['/c/messages'], { queryParams: { with: 'admin-user-1' } });
      drainAndVerify(h.http);
    });

    it('contactAdmin sin contacto de admin resuelto navega a mensajes sin queryParams', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ adminContact: null }) });
      h.fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      h.component.contactAdmin();

      expect(navSpy).toHaveBeenCalledWith(['/c/messages']);
      drainAndVerify(h.http);
    });

    it('"Ver todas" en comunicaciones recientes cambia a la pestaña de comunicados', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { communications: { items: [makeCommunication()], total: 1, page: 1, pageSize: 20 } });
      h.fixture.detectChanges();

      (h.el.querySelector('.comms-card .link-btn') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('communications');
      drainAndVerify(h.http);
    });
  });

  // ── Comunicados ─────────────────────────────────────────────────────
  describe('comunicados', () => {
    async function openCommsTab(h: ComponentHarness<PropertyDetailComponent>, opts: LoadOpts = {}): Promise<void> {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, opts);
      h.component.setTab('communications');
      h.fixture.detectChanges();
    }

    it('renderiza la lista con indicador de no leído', async () => {
      const h = setup();
      await openCommsTab(h, { communications: { items: [makeCommunication({ id: 'c1', read: false }), makeCommunication({ id: 'c2', read: true })], total: 2, page: 1, pageSize: 20 } });

      expect(h.el.querySelectorAll('.comm-card')).toHaveLength(2);
      expect(h.el.querySelectorAll('.comm-card--unread')).toHaveLength(1);
      drainAndVerify(h.http);
    });

    it('al hacer clic en un comunicado, lo marca como leído de forma optimista y lo persiste', async () => {
      const h = setup();
      await openCommsTab(h, { communications: { items: [makeCommunication({ id: 'c1', read: false })], total: 1, page: 1, pageSize: 20 } });

      (h.el.querySelector('.comm-card') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.comm-card--unread')).toBeNull();
      const req = h.http.expectOne((r) => r.url === `${API}/resource-reads` && r.method === 'POST');
      expect(req.request.body).toEqual({ sourceType: 'communication', sourceId: 'c1' });
      req.flush(null);
      await settle();
      drainAndVerify(h.http);
    });

    it('"Marcar como leídos" marca todos los comunicados', async () => {
      const h = setup();
      await openCommsTab(h, { communications: { items: [makeCommunication({ id: 'c1', read: false }), makeCommunication({ id: 'c2', read: false })], total: 2, page: 1, pageSize: 20 } });

      (Array.from(h.el.querySelectorAll('.action-btn--outline')).find((b) => b.textContent?.includes('Marcar como leídos')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.comm-card--unread')).toHaveLength(0);
      const reqs = h.http.match((r) => r.url === `${API}/resource-reads` && r.method === 'POST');
      expect(reqs).toHaveLength(2);
      reqs.forEach((r) => r.flush(null));
      await settle();
      drainAndVerify(h.http);
    });

    it('"Cargar más" pagina y añade a la lista existente', async () => {
      const h = setup();
      await openCommsTab(h, { communications: { items: [makeCommunication({ id: 'c1' })], total: 3, page: 1, pageSize: 20 } });

      expect(h.component.hasMoreCommunications()).toBe(true);
      const promise = h.component.loadMoreCommunications();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.params.get('page') === '2');
      req.flush({ items: [makeCommunication({ id: 'c2' }), makeCommunication({ id: 'c3' })], total: 3, page: 2, pageSize: 20 });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.communications().map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
      expect(h.component.hasMoreCommunications()).toBe(false);
      drainAndVerify(h.http);
    });
  });

  // ── Comunicados — alta/edición/archivado (rol C, solo lo propio) ────
  describe('comunicados — alta/edición/archivado', () => {
    async function openCommsTab(h: ComponentHarness<PropertyDetailComponent>, opts: LoadOpts = {}): Promise<void> {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, opts);
      h.component.setTab('communications');
      h.fixture.detectChanges();
    }

    it('el botón "Nuevo comunicado" abre el formulario vacío', async () => {
      const h = setup();
      await openCommsTab(h);

      (Array.from(h.el.querySelectorAll('.comm-toolbar-actions .btn')).find((b) => b.textContent?.includes('Nuevo comunicado')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.showNuevoComunicado()).toBe(true);
      expect(h.component.commEditingId()).toBeNull();
      drainAndVerify(h.http);
    });

    it('nuevo comunicado sin título/mensaje muestra errores de validación y no envía nada', async () => {
      const h = setup();
      await openCommsTab(h);

      h.component.openNuevoComunicado();
      h.fixture.detectChanges();
      await h.component.submitComunicado();
      h.fixture.detectChanges();

      expect(h.component.commErrors()).toEqual({ title: true, body: true });
      expect(h.el.querySelectorAll('.form-error')).toHaveLength(2);
      h.http.expectNone((r) => r.method === 'POST' && r.url.includes('/communications'));
      drainAndVerify(h.http);
    });

    it('crear un comunicado válido (con vigencia) lo publica, recarga la lista y muestra un toast', async () => {
      const h = setup();
      await openCommsTab(h);

      h.component.openNuevoComunicado();
      h.component.commTitle.set('Corte de agua');
      h.component.commBody.set('Habrá corte de agua el lunes de 9 a 13h');
      h.component.commActiveUntil.set('2026-07-01');
      h.fixture.detectChanges();

      const promise = h.component.submitComunicado();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'POST');
      expect(req.request.body).toEqual({ title: 'Corte de agua', body: 'Habrá corte de agua el lunes de 9 a 13h', activeUntil: '2026-07-01', category: 'General' });
      req.flush(makeCommunication({ id: 'c-nuevo', title: 'Corte de agua', body: 'Habrá corte de agua el lunes de 9 a 13h', authorUserId: 'u1' }));
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [makeCommunication({ id: 'c-nuevo', title: 'Corte de agua', authorUserId: 'u1' })], total: 1, page: 1, pageSize: 20 });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoComunicado()).toBe(false);
      expect(h.component.communications().map((c) => c.id)).toEqual(['c-nuevo']);
      expect(h.component.toastMessage()).toContain('Comunicado publicado correctamente');
      drainAndVerify(h.http);
    });

    it('las acciones "Editar"/"Eliminar" solo aparecen en los comunicados propios', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: {
          items: [
            makeCommunication({ id: 'c-propio', authorUserId: 'u1', title: 'Mío' }),
            makeCommunication({ id: 'c-ajeno', authorUserId: 'otro-user', title: 'Ajeno' }),
          ],
          total: 2, page: 1, pageSize: 20,
        },
      });

      const cards = Array.from(h.el.querySelectorAll('.comm-card'));
      const propio = cards.find((c) => c.textContent?.includes('Mío'))!;
      const ajeno = cards.find((c) => c.textContent?.includes('Ajeno'))!;

      expect(propio.querySelector('.comm-card__actions')).not.toBeNull();
      expect(ajeno.querySelector('.comm-card__actions')).toBeNull();
      drainAndVerify(h.http);
    });

    it('editar un comunicado propio precarga el formulario y guarda los cambios vía updateCommunication', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: {
          items: [makeCommunication({ id: 'c1', authorUserId: 'u1', title: 'Original', body: 'Texto original', activeUntil: '2026-08-01' })],
          total: 1, page: 1, pageSize: 20,
        },
      });

      h.component.openEditarComunicado(h.component.communications()[0]);
      h.fixture.detectChanges();

      expect(h.component.commEditingId()).toBe('c1');
      expect(h.component.commTitle()).toBe('Original');
      expect(h.component.commBody()).toBe('Texto original');
      expect(h.component.commActiveUntil()).toBe('2026-08-01');

      h.component.commTitle.set('Editado');
      h.component.commBody.set('Texto editado');
      h.fixture.detectChanges();

      const promise = h.component.submitComunicado();
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ title: 'Editado', body: 'Texto editado', activeUntil: '2026-08-01', category: 'General' });
      req.flush(makeCommunication({ id: 'c1', authorUserId: 'u1', title: 'Editado', body: 'Texto editado' }));
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [makeCommunication({ id: 'c1', authorUserId: 'u1', title: 'Editado' })], total: 1, page: 1, pageSize: 20 });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoComunicado()).toBe(false);
      expect(h.component.toastMessage()).toContain('Comunicado actualizado correctamente');
      drainAndVerify(h.http);
    });

    it('responder a un comunicado ajeno lo añade al hilo sin recargar la lista', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: { items: [makeCommunication({ id: 'c1', authorUserId: 'admin-1', from: 'Gestora' })], total: 1, page: 1, pageSize: 20 },
      });

      h.component.setCommReplyText('c1', 'Gracias por avisar');
      const promise = h.component.sendCommunicationReply(h.component.communications()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/replies` && r.method === 'POST');
      expect(req.request.body).toEqual({ text: 'Gracias por avisar' });
      req.flush({ id: 'r1', communicationId: 'c1', authorUserId: 'u1', authorName: 'Vecino Uno', role: 'Propietario', text: 'Gracias por avisar', createdAt: '2026-06-02' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.communications()[0].replies).toHaveLength(1);
      expect(h.component.commReplyText('c1')).toBe('');
      expect(h.el.textContent).toContain('Gracias por avisar');
      drainAndVerify(h.http);
    });

    it('muestra el badge de categoría cuando no es General', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: { items: [makeCommunication({ id: 'c1', category: 'Evento' })], total: 1, page: 1, pageSize: 20 },
      });

      expect(h.el.textContent).toContain('Evento');
      drainAndVerify(h.http);
    });

    it('eliminar un comunicado propio pide confirmación y lo borra vía deleteCommunication', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: { items: [makeCommunication({ id: 'c1', authorUserId: 'u1', title: 'A borrar' })], total: 1, page: 1, pageSize: 20 },
      });
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const promise = h.component.deleteComunicado(h.component.communications()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1` && r.method === 'DELETE');
      req.flush(null);
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [], total: 0, page: 1, pageSize: 20 });
      await promise;
      h.fixture.detectChanges();

      expect(confirmSpy).toHaveBeenCalled();
      expect(h.component.communications()).toHaveLength(0);
      expect(h.component.toastMessage()).toContain('Comunicado eliminado');
      drainAndVerify(h.http);
    });

    it('declinar la confirmación de borrado no llama al backend', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: { items: [makeCommunication({ id: 'c1', authorUserId: 'u1' })], total: 1, page: 1, pageSize: 20 },
      });
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      await h.component.deleteComunicado(h.component.communications()[0]);

      h.http.expectNone((r) => r.method === 'DELETE');
      drainAndVerify(h.http);
    });

    it('el filtro "Archivados" recarga la página 1 con filter=archived; "Activos" vuelve a filter=active', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: { items: [makeCommunication({ id: 'c1' })], total: 1, page: 1, pageSize: 20 },
      });

      (Array.from(h.el.querySelectorAll('.inc-filter')).find((b) => b.textContent?.includes('Archivados')) as HTMLElement).click();
      const archivedReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.params.get('filter') === 'archived' && r.params.get('page') === '1');
      archivedReq.flush({ items: [makeCommunication({ id: 'c-archivado', archived: true })], total: 1, page: 1, pageSize: 20 });
      await settle();
      h.fixture.detectChanges();

      expect(h.component.commFilter()).toBe('archived');
      expect(h.component.communications().map((c) => c.id)).toEqual(['c-archivado']);

      (Array.from(h.el.querySelectorAll('.inc-filter')).find((b) => b.textContent?.includes('Activos')) as HTMLElement).click();
      const activeReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.params.get('filter') === 'active' && r.params.get('page') === '1');
      activeReq.flush({ items: [makeCommunication({ id: 'c1' })], total: 1, page: 1, pageSize: 20 });
      await settle();
      h.fixture.detectChanges();

      expect(h.component.commFilter()).toBe('active');
      drainAndVerify(h.http);
    });

    it('muestra "Editado por X" cuando lastEditedByUserId está seteado y difiere del autor', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: {
          items: [
            makeCommunication({ id: 'c1', authorUserId: 'u1', lastEditedByUserId: 'admin-1', lastEditedByName: 'Gestora Sol', lastEditedAt: '2026-06-10T10:00:00.000Z' }),
            makeCommunication({ id: 'c2', authorUserId: 'u1' }),
          ],
          total: 2, page: 1, pageSize: 20,
        },
      });

      expect(h.el.textContent).toContain('Editado por Gestora Sol');
      expect(h.el.querySelectorAll('.comm-card__trace')).toHaveLength(1);
      drainAndVerify(h.http);
    });

    it('no muestra la traza de edición cuando el autor edita lo suyo (lastEditedByUserId === authorUserId)', async () => {
      const h = setup();
      await openCommsTab(h, {
        communications: {
          items: [makeCommunication({ id: 'c1', authorUserId: 'u1', lastEditedByUserId: 'u1', lastEditedByName: 'Yo mismo' })],
          total: 1, page: 1, pageSize: 20,
        },
      });

      expect(h.el.querySelector('.comm-card__trace')).toBeNull();
      drainAndVerify(h.http);
    });
  });

  // ── Incidencias ─────────────────────────────────────────────────────
  // Las incidencias se gestionan solo en /c/incidencias; la cabecera deja un atajo (la propiedad solo dice en qué comunidad).
  describe('incidencias', () => {
    it('el botón "Reportar incidencia" de la cabecera abre el alta en la página de incidencias, en la comunidad de la propiedad', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();
      const navSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      (Array.from(h.el.querySelectorAll('.action-btn--outline')).find((b) => b.textContent?.includes('Reportar incidencia')) as HTMLElement).click();

      expect(navSpy).toHaveBeenCalledWith(['/c/incidencias'], { queryParams: { new: '1', estateId: 'e1' } });
      expect(h.el.querySelector('.modal')).toBeNull();
      drainAndVerify(h.http);
    });
  });

  // ── Documentos ──────────────────────────────────────────────────────
  describe('documentos', () => {
    it('la ficha ya no tiene pestaña de Documentos ni pide los documentos de la finca', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.tabs().map((t) => t.id)).toEqual(['summary', 'communications', 'reservas']);
      expect(Array.from(h.el.querySelectorAll('.tab')).some((b) => b.textContent?.includes('Documentos'))).toBe(false);
      expect(h.el.querySelector('app-owner-library')).toBeNull();
      h.http.expectNone((r) => r.url.includes('/documents') || r.url.includes('/library'));
      drainAndVerify(h.http);
    });

    it('un ?tab=documents residual se queda en resumen', async () => {
      const h = setup({ query: { tab: 'documents' } });
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('summary');
      drainAndVerify(h.http);
    });
  });

  // ── Reservas ────────────────────────────────────────────────────────
  describe('reservas', () => {
    async function openReservasTab(h: ComponentHarness<PropertyDetailComponent>, opts: LoadOpts = {}): Promise<void> {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { amenities: [makeAmenity()], ...opts });
      h.component.setTab('reservas');
      h.fixture.detectChanges();
    }

    it('muestra el grid de instalaciones y los contadores de reservas', async () => {
      const h = setup();
      await openReservasTab(h, {
        amenities: [makeAmenity({ id: 'am1', name: 'Piscina' })],
        bookings: [
          makeBooking({ id: 'b1', amenityId: 'am1', status: 'confirmed', date: '2026-06-20' }),
          makeBooking({ id: 'b2', amenityId: 'am1', status: 'completed', date: '2026-05-01' }),
        ],
      });

      expect(h.el.textContent).toContain('Piscina');
      const stats = h.el.querySelectorAll('.stat-card__value');
      expect(stats[0]?.textContent?.trim()).toBe('1'); // próximas
      expect(stats[1]?.textContent?.trim()).toBe('1'); // completadas
      expect(stats[2]?.textContent?.trim()).toBe('2'); // total
      drainAndVerify(h.http);
    });

    it('el filtro de próximas/anteriores cambia la lista visible', async () => {
      const h = setup();
      await openReservasTab(h, {
        bookings: [
          makeBooking({ id: 'b-futura', amenityId: 'am1', status: 'confirmed', date: '2026-06-20' }),
          makeBooking({ id: 'b-pasada', amenityId: 'am1', status: 'completed', date: '2026-05-01' }),
        ],
      });

      h.component.reservaFilter.set('upcoming');
      h.fixture.detectChanges();
      expect(h.el.querySelectorAll('.booking-row')).toHaveLength(1);

      h.component.reservaFilter.set('past');
      h.fixture.detectChanges();
      expect(h.el.querySelectorAll('.booking-row')).toHaveLength(1);
      drainAndVerify(h.http);
    });

    it('al hacer clic en una reserva se abre su detalle', async () => {
      const h = setup();
      await openReservasTab(h, { bookings: [makeBooking({ id: 'b1', amenityId: 'am1', amenityName: 'Piscina', date: '2026-06-20' })] });

      (h.el.querySelector('.booking-row') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.selectedBooking()?.id).toBe('b1');
      expect(h.el.querySelector('.drawer')?.textContent).toContain('Piscina');
      drainAndVerify(h.http);
    });

    it('cancelar una reserva confirmada requiere confirmación y llama al backend', async () => {
      const h = setup();
      await openReservasTab(h, { bookings: [makeBooking({ id: 'b1', amenityId: 'am1', status: 'confirmed' })] });
      h.component.openBookingDetail(h.component.bookings()[0]);
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.drawer__footer button')).find((b) => b.textContent?.includes('Cancelar reserva')) as HTMLElement).click();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('¿Seguro que quieres cancelar esta reserva?');

      (Array.from(h.el.querySelectorAll('.drawer__footer button')).find((b) => b.textContent?.includes('Sí, cancelar')) as HTMLElement).click();
      const req = h.http.expectOne((r) => r.url === `${API}/bookings/b1/cancel` && r.method === 'PATCH');
      req.flush(null);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.bookings()[0].status).toBe('cancelled');
      expect(h.component.selectedBooking()).toBeNull();
      expect(h.component.toastMessage()).toContain('Reserva cancelada');
      drainAndVerify(h.http);
    });

    it('declinar la cancelación ("No, mantener") no llama al backend', async () => {
      const h = setup();
      await openReservasTab(h, { bookings: [makeBooking({ id: 'b1', amenityId: 'am1', status: 'confirmed' })] });
      h.component.openBookingDetail(h.component.bookings()[0]);
      h.component.requestCancel();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.drawer__footer button')).find((b) => b.textContent?.includes('No, mantener')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.cancelConfirm()).toBe(false);
      expect(h.component.selectedBooking()).not.toBeNull();
      h.http.expectNone((r) => r.method === 'PATCH');
      drainAndVerify(h.http);
    });

    it('el mini-calendario navega de mes hacia delante y hacia atrás', async () => {
      const h = setup();
      await openReservasTab(h);
      expect(h.component.calendarLabel()).toBe('junio 2026');

      (h.el.querySelector('.calendar-card .calendar-header button:last-child') as HTMLElement).click();
      h.fixture.detectChanges();
      expect(h.component.calendarLabel()).toBe('julio 2026');

      (h.el.querySelector('.calendar-card .calendar-header button:first-child') as HTMLElement).click();
      (h.el.querySelector('.calendar-card .calendar-header button:first-child') as HTMLElement).click();
      h.fixture.detectChanges();
      expect(h.component.calendarLabel()).toBe('mayo 2026');
      drainAndVerify(h.http);
    });

    it('los días pasados del calendario están deshabilitados; un día futuro es seleccionable', async () => {
      const h = setup();
      await openReservasTab(h);

      const dayButtons = Array.from(h.el.querySelectorAll('.calendar-card .calendar-day')) as HTMLButtonElement[];
      const pastDay = dayButtons.find((b) => b.textContent?.trim() === '1');
      expect(pastDay?.disabled).toBe(true);

      const futureDay = dayButtons.find((b) => b.textContent?.trim() === '20');
      futureDay!.click();
      h.fixture.detectChanges();

      expect(h.component.selectedDate()).toBe('2026-06-20');
      drainAndVerify(h.http);
    });

    describe('estado vacío (sin instalaciones)', () => {
      it('muestra el mensaje de "sin instalaciones reservables" y la pestaña no existe', async () => {
        const h = setup();
        h.fixture.detectChanges();
        await flushInitialLoad(h.http, { amenities: [] });
        h.fixture.detectChanges();

        expect(h.component.tabs().map((t) => t.id)).not.toContain('reservas');
        drainAndVerify(h.http);
      });
    });

    describe('wizard "Nueva reserva"', () => {
      function modalEl(h: ComponentHarness<PropertyDetailComponent>): HTMLElement {
        const modal = h.el.querySelector('.modal-backdrop .modal') as HTMLElement | null;
        if (!modal) throw new Error('modal de nueva reserva no encontrado');
        return modal;
      }

      it('abrir desde una instalación concreta salta directo al paso de fecha', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1', name: 'Piscina' })] });

        (Array.from(h.el.querySelectorAll('.amenity-card .btn')).find((b) => b.textContent?.includes('Reservar')) as HTMLElement).click();
        h.fixture.detectChanges();

        expect(h.component.reservaStep()).toBe(1);
        expect(h.component.selectedAmenity()?.id).toBe('am1');
        drainAndVerify(h.http);
      });

      it('abrir desde el botón genérico empieza en la elección de instalación, con "Continuar" deshabilitado', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1' })] });

        (Array.from(h.el.querySelectorAll('.reservas-toolbar button')).find((b) => b.textContent?.includes('Nueva reserva')) as HTMLElement).click();
        h.fixture.detectChanges();

        expect(h.component.reservaStep()).toBe(0);
        const continueBtn = Array.from(modalEl(h).querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Continuar')) as HTMLButtonElement;
        expect(continueBtn.disabled).toBe(true);

        (modalEl(h).querySelector('.amenity-card--select') as HTMLElement).click();
        h.fixture.detectChanges();
        expect(continueBtn.disabled).toBe(false);
        drainAndVerify(h.http);
      });

      it('seleccionar fecha en el paso 1 consulta la disponibilidad de la instalación', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1' })] });
        h.component.openNuevaReserva(h.component.amenities()[0]);
        h.fixture.detectChanges();

        const futureDay = Array.from(modalEl(h).querySelectorAll('.calendar-day')).find((b) => b.textContent?.trim() === '20') as HTMLElement;
        futureDay.click();
        const req = h.http.expectOne((r) => r.url === `${API}/amenities/am1/availability` && r.params.get('date') === '2026-06-20');
        req.flush({ amenityId: 'am1', date: '2026-06-20', slots: makeAmenity().slots, occupied: ['10:00'], blocked: false });
        await settle();
        h.fixture.detectChanges();

        expect(h.component.selectedDate()).toBe('2026-06-20');
        expect(h.component.occupiedSlots()).toEqual(['10:00']);
        drainAndVerify(h.http);
      });

      it('los huecos ocupados no se pueden seleccionar y no se puede superar el máximo de horas', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1', maxHours: 1, slots: ['09:00', '10:00'] })] });
        h.component.openNuevaReserva(h.component.amenities()[0]);
        h.component.selectedDate.set('2026-06-20');
        h.component.occupiedSlots.set(['09:00']);
        h.fixture.detectChanges();

        const slotBtns = Array.from(modalEl(h).querySelectorAll('.slot')) as HTMLButtonElement[];
        const occupiedBtn = slotBtns.find((b) => b.textContent?.trim() === '09:00')!;
        expect(occupiedBtn.disabled).toBe(true);

        h.component.toggleSlot('09:00'); // ocupado: no debe seleccionarse
        expect(h.component.selectedSlots()).toEqual([]);

        h.component.toggleSlot('10:00');
        expect(h.component.selectedSlots()).toEqual(['10:00']);

        // maxHours=1: ya hay un slot seleccionado, no permite añadir otro (aquí no hay más libres, se prueba con el propio método)
        h.component.toggleSlot('11:00');
        expect(h.component.selectedSlots()).toEqual(['10:00']);
        drainAndVerify(h.http);
      });

      it('el contador de personas respeta el aforo máximo y el mínimo de 1', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1', capacity: 2 })] });
        h.component.openNuevaReserva(h.component.amenities()[0]);
        h.fixture.detectChanges();

        h.component.incGuests();
        h.component.incGuests();
        h.component.incGuests();
        expect(h.component.guestCount()).toBe(2); // tope de aforo

        h.component.decGuests();
        h.component.decGuests();
        h.component.decGuests();
        expect(h.component.guestCount()).toBe(1); // mínimo 1
        drainAndVerify(h.http);
      });

      it('confirmar la reserva la antepone a la lista, cierra el modal y muestra un toast', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1', name: 'Piscina', slots: ['09:00', '10:00', '11:00'] })], bookings: [makeBooking({ id: 'b-vieja', amenityId: 'am1' })] });
        h.component.openNuevaReserva(h.component.amenities()[0]);
        h.component.selectedDate.set('2026-06-20');
        h.component.selectedSlots.set(['10:00']);
        h.component.reservaStep.set(2);
        h.fixture.detectChanges();

        const confirmBtn = Array.from(modalEl(h).querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Confirmar reserva')) as HTMLElement;
        confirmBtn.click();
        const req = h.http.expectOne((r) => r.url === `${API}/bookings` && r.method === 'POST');
        expect(req.request.body).toMatchObject({ amenityId: 'am1', propertyId: 'p1', date: '2026-06-20', startSlot: '10:00', endSlot: '11:00', guests: 1 });
        req.flush(makeBooking({ id: 'b-nueva', amenityId: 'am1', date: '2026-06-20', startSlot: '10:00', endSlot: '11:00' }));
        await settle();
        h.fixture.detectChanges();

        expect(h.component.bookings()[0].id).toBe('b-nueva');
        expect(h.component.showNuevaReserva()).toBe(false);
        expect(h.component.toastMessage()).toContain('Reserva confirmada correctamente');
        drainAndVerify(h.http);
      });

      it('si falla la creación, muestra un toast de error y no cierra el modal', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1' })] });
        h.component.openNuevaReserva(h.component.amenities()[0]);
        h.component.selectedDate.set('2026-06-20');
        h.component.selectedSlots.set(['09:00']);
        h.component.reservaStep.set(2);
        h.fixture.detectChanges();

        const promise = h.component.confirmReserva();
        const req = h.http.expectOne((r) => r.url === `${API}/bookings` && r.method === 'POST');
        req.flush({ message: 'ocupado' }, { status: 409, statusText: 'Conflict' });
        await promise;
        h.fixture.detectChanges();

        expect(h.component.showNuevaReserva()).toBe(true);
        expect(h.component.toastMessage()).toContain('No se pudo crear la reserva');
        drainAndVerify(h.http);
      });

      it('"Atrás" retrocede un paso y "Cancelar" cierra el wizard', async () => {
        const h = setup();
        await openReservasTab(h, { amenities: [makeAmenity({ id: 'am1' })] });
        h.component.openNuevaReserva(h.component.amenities()[0]); // arranca en paso 1
        h.fixture.detectChanges();

        (Array.from(modalEl(h).querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Atrás')) as HTMLElement).click();
        h.fixture.detectChanges();
        expect(h.component.reservaStep()).toBe(0);

        (Array.from(modalEl(h).querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Cancelar')) as HTMLElement).click();
        h.fixture.detectChanges();
        expect(h.component.showNuevaReserva()).toBe(false);
        drainAndVerify(h.http);
      });
    });
  });

  // ── Vinculación ─────────────────────────────────────────────────────
  describe('vinculación', () => {
    it('con linkageStatus "linked" muestra el banner correspondiente', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ linkageStatus: 'linked' }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.vinc-banner--linked')).not.toBeNull();
      drainAndVerify(h.http);
    });

    it('con linkageStatus "pending" muestra el banner de solicitud enviada', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ linkageStatus: 'pending' }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.vinc-banner--pending')).not.toBeNull();
      drainAndVerify(h.http);
    });

    it('con linkageStatus "revoked" muestra el banner de revocación con acción para reintentar', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ linkageStatus: 'revoked' }) });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.vinc-banner--revoked')).not.toBeNull();
      drainAndVerify(h.http);
    });

    it('sin vincular muestra el banner "sin vincular"', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { property: makeProperty({ estateId: null }), view: null });
      h.fixture.detectChanges();

      expect(h.el.querySelector('.vinc-banner--none')).not.toBeNull();
      drainAndVerify(h.http);
    });

    it('abrir el modal reinicia el asistente a su primer paso', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      h.component.vincStep.set(2);
      h.component.openVinculacionModal();
      h.fixture.detectChanges();

      expect(h.component.vincStep()).toBe(0);
      expect(h.component.showVinculacionModal()).toBe(true);
      drainAndVerify(h.http);
    });

    it('modo "comunidad existente" sin catálogo disponible nunca permite continuar', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      h.component.openVinculacionModal();
      h.component.vincNext(); // paso 1, modo existing por defecto
      h.fixture.detectChanges();

      expect(h.component.filteredLinkEstates()).toHaveLength(0);
      expect(h.component.vincCanContinue()).toBe(false);
      drainAndVerify(h.http);
    });

    it('modo "solicitar alta": completar el nombre habilita continuar, y enviar la solicitud marca la propiedad como pendiente', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { view: makePropertyView({ linkageStatus: 'none' }) });
      h.fixture.detectChanges();

      h.component.openVinculacionModal();
      h.component.vincMode.set('request');
      h.fixture.detectChanges();
      expect(h.component.vincCanContinue()).toBe(true); // paso 0 siempre permite continuar

      h.component.vincNext(); // paso 1
      h.fixture.detectChanges();
      expect(h.component.vincCanContinue()).toBe(false);

      h.component.vincName.set('Residencial Los Álamos');
      h.fixture.detectChanges();
      expect(h.component.vincCanContinue()).toBe(true);

      h.component.vincNext(); // paso 2, confirmación
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Residencial Los Álamos');

      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Enviar solicitud de alta')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.linkageStatus()).toBe('pending');
      expect(h.component.showVinculacionModal()).toBe(false);
      expect(h.component.toastMessage()).toContain('Solicitud de vinculación enviada');
      h.http.expectNone((r) => r.method === 'POST' && r.url.includes('adhesion'));
      drainAndVerify(h.http);
    });

    it('"Atrás" retrocede un paso del asistente de vinculación', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      h.component.openVinculacionModal();
      h.component.vincMode.set('request');
      h.component.vincName.set('X');
      h.component.vincNext();
      h.fixture.detectChanges();
      expect(h.component.vincStep()).toBe(1);

      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Atrás')) as HTMLElement).click();
      h.fixture.detectChanges();
      expect(h.component.vincStep()).toBe(0);
      drainAndVerify(h.http);
    });

    it('"Cancelar" cierra el modal sin enviar ninguna solicitud', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      h.component.openVinculacionModal();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Cancelar')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.showVinculacionModal()).toBe(false);
      expect(h.component.linkageStatus()).not.toBe('pending');
      drainAndVerify(h.http);
    });

    it('el botón "Editar vinculación" de la cabecera abre el mismo modal', async () => {
      const h = setup();
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.action-btn--outline')).find((b) => b.textContent?.includes('Editar vinculación')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.showVinculacionModal()).toBe(true);
      drainAndVerify(h.http);
    });
  });
});
