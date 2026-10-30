import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { API, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { EstateDetailComponent } from './estate-detail.component';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PropertiesTabComponent } from './properties-tab/properties-tab.component';
import { EstateNavigationService } from '../../core/estate-navigation.service';
import type {
  Estate, OwnerProperty, AdhesionRequest, EstateSepaBilling, ExternalOwner,
  EstateSetupStatus,
} from '../../core/models';

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    address: 'Calle Mayor', streetNumber: '10', location: 'Madrid',
    properties: 0, residents: 0, requests: 0, activeIssues: 0, occupancy: 0,
    reserveTarget: 1000, iban: undefined, color: null,
    ...overrides,
  };
}

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return {
    id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado',
    viaType: 'Calle', viaName: 'Mayor', streetNumber: '10', staircase: '1', floor: '2', door: 'A',
    ref: '1-2A', quotaMonthly: 100, balance: 0, pendingDocs: 0, openIssues: 0,
    ...overrides,
  } as OwnerProperty;
}

function makeRequest(overrides: Partial<AdhesionRequest> & { user?: { fullName: string; email: string } } = {}): AdhesionRequest {
  return {
    id: 'r1', estateId: 'e1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario',
    submittedAt: '2026-03-01T10:00:00.000Z', status: 'pending',
    user: { fullName: 'Ana García', email: 'ana@test.com' },
    ...overrides,
  } as AdhesionRequest;
}

function makeSepaBilling(overrides: Partial<EstateSepaBilling> = {}): EstateSepaBilling {
  return {
    creditorId: 'ES23000B00000000', creditorIbanMasked: 'ES12 **** **** **** 1234', creditorBic: 'CAIXESBBXXX',
    creditorPostalAddress: 'Calle Mayor 10',
    ...overrides,
  };
}

function withRoute(id = 'e1', query: Record<string, string> = {}): unknown[] {
  return [
    {
      provide: ActivatedRoute,
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id }),
          queryParamMap: convertToParamMap({ tab: 'properties', ...query }),
        },
      },
    },
  ];
}

interface InitialLoadOpts {
  estate?: Estate | null;
  properties?: OwnerProperty[];
  requests?: AdhesionRequest[];
  externalOwners?: ExternalOwner[];
  /** propertyId -> titular con cuenta que devuelve primary-contact (por defecto, ninguno). */
  primaryContacts?: Record<string, { fullName: string; roleType: string }>;
}

/**
 * ngOnInit: findEstateById -> Promise.all([listPropertiesByEstate, listPendingAdhesionRequestsByEstate])
 * -> (fire-and-forget) loadTitulares (findPrimaryContact por propiedad) + applyQueryParamDeepLink (síncrono, puede
 * abrir una pestaña). Todo eso queda pendiente en el mismo tick, así que
 * se flushea junto tras un solo `await settle()`.
 */
async function flushInitialLoad(h: ComponentHarness<EstateDetailComponent>, opts: InitialLoadOpts = {}): Promise<void> {
  const estate = opts.estate === undefined ? makeEstate() : opts.estate;
  const estateId = estate?.id ?? 'e1';
  h.fixture.detectChanges();
  h.http.expectOne((r) => r.url === `${API}/estates/${estateId}`).flush(estate);
  await settle();
  if (!estate) {
    h.fixture.detectChanges();
    return;
  }
  const properties = opts.properties ?? [];
  const requests = opts.requests ?? [];
  h.http.expectOne((r) => r.url === `${API}/estates/${estateId}/properties`).flush(properties);
  h.http.expectOne((r) => r.url === `${API}/estates/${estateId}/adhesion-requests`).flush(requests);
  await settle();
  await flushTitulares(h, estateId, properties, opts);
}

/** loadTitulares: primary-contact por propiedad + una sola lista de titulares externos de la finca. */
async function flushTitulares(
  h: ComponentHarness<EstateDetailComponent>,
  estateId: string,
  properties: OwnerProperty[],
  opts: Pick<InitialLoadOpts, 'externalOwners' | 'primaryContacts'> = {},
): Promise<void> {
  h.http.expectOne((r) => r.url === `${API}/estates/${estateId}/external-owners`).flush(opts.externalOwners ?? []);
  for (const p of properties) {
    const pc = opts.primaryContacts?.[p.id];
    h.http.expectOne((r) => r.url === `${API}/properties/${p.id}/memberships/primary-contact`).flush(
      pc ? { roleType: pc.roleType, user: { fullName: pc.fullName } } : null, // la API devuelve la membresía con `user` embebido
    );
  }
  await settle();
  h.fixture.detectChanges();
}

function makeExternalOwner(overrides: Partial<ExternalOwner> = {}): ExternalOwner {
  return {
    id: 'eo1', propertyId: 'p1', fullName: 'Titular Importado', roleType: 'Propietario',
    createdAt: '2026-09-01', createdByUserId: 'b1', promotedToUserId: null,
    ...overrides,
  };
}

function makeSetupStatus(overrides: Partial<EstateSetupStatus> = {}): EstateSetupStatus {
  return {
    estateId: 'e1', requiredDone: 4, requiredTotal: 4, complete: true, invitableOwners: 0,
    steps: [
      { key: 'fiscal', weight: 'required', status: 'done' },
      { key: 'properties', weight: 'required', status: 'done', done: 1 },
      { key: 'quotas', weight: 'required', status: 'done', done: 1, total: 1 },
      { key: 'coefficients', weight: 'recommended', status: 'done', done: 1, total: 1 },
      { key: 'owners', weight: 'required', status: 'done', done: 1, total: 1 },
      { key: 'sepa', weight: 'recommended', status: 'done', done: 3, total: 3 },
      { key: 'linked', weight: 'info', status: 'done', done: 1, total: 1 },
    ],
    ...overrides,
  };
}

/** Indicadores del Resumen: no es lo que prueban estos tests; se contesta en segundo plano. */
const EMPTY_DASHBOARD = {
  estateId: 'e1', units: 0, balance: 0, pendingDues: { amount: 0, properties: 0 },
  issues: { open: 0, thisYear: 0 }, nextMeeting: null,
};

const EMPTY_CASHFLOW = { year: 2026, years: [2026], months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expenses: 0 })) };

describe('EstateDetailComponent', () => {
  let h: ComponentHarness<EstateDetailComponent>;

  afterEach(() => {
    // La puesta en marcha se refresca en segundo plano tras cada guardado —
    // no es lo que prueban esos tests; los que sí la prueban la flushean
    // explícitamente antes de llegar aquí.
    h.http.match((r) => r.url.endsWith('/setup-status')).forEach((req) => req.flush(makeSetupStatus()));
    h.http.match((r) => r.url.endsWith('/ai/intelligence')).forEach((req) => req.flush({ latest: null, processing: null }));
    h.http.match((r) => r.url.endsWith('/dashboard/summary')).forEach((req) => req.flush(EMPTY_DASHBOARD));
    h.http.match((r) => r.url.endsWith('/dashboard/cashflow')).forEach((req) => req.flush(EMPTY_CASHFLOW));
    h.http.match((r) => r.url.endsWith('/dashboard/expense-breakdown')).forEach((req) => req.flush({ year: 2026, total: 0, categories: [] }));
    h.http.match((r) => r.url.endsWith('/dashboard/milestones')).forEach((req) => req.flush({ items: [] }));
    h.http.match((r) => r.url.endsWith('/dashboard/activity')).forEach((req) => req.flush({ items: [] }));
    h.http.match((r) => r.url.endsWith('/dashboard/properties')).forEach((req) => req.flush({ total: 0, items: [] }));
    h.http.match((r) => r.url.endsWith('/dashboard/property-statuses')).forEach((req) => req.flush({ items: [] }));
    h.http.match((r) => r.method === 'GET' && /\/issues\/[^/]+(\/situation)?$/.test(r.url)).forEach((req) => req.flush(null));
    h.http.match((r) => r.method === 'GET' && /\/issues\/[^/]+\/insurance-claims$/.test(r.url)).forEach((req) => req.flush([]));
    h.http.match((r) => r.method === 'GET' && /\/issues\/[^/]+\/visits$/.test(r.url)).forEach((req) => req.flush([]));
    // Si la finca trae foto subida, la cabecera y el Resumen la piden (GET .../photo).
    h.http.match((r) => r.method === 'GET' && r.url.startsWith(`${API}/estates/e1/photo`)).forEach((req) => req.flush(new Blob(['x'], { type: 'image/png' })));
    h.http.match((r) => r.url.endsWith('/office-terms')).forEach((req) => req.flush([]));
    h.http.match((r) => r.url.endsWith('/general-overview')).forEach((req) => req.flush({}));
    h.http.verify();
  });

  describe('navegación por apartados', () => {
    it('Domora Intelligence vive en el Resumen, encima de sus accesos, y usa la finca seleccionada', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'summary' }) });
      await flushInitialLoad(h);
      const panel = h.el.querySelector('app-intelligence-panel');
      expect(panel).not.toBeNull();
      h.http.expectOne(`${API}/estates/e1/ai/intelligence`).flush({
        latest: {
          id: 'review1', weekKey: '2026-W41', snapshotAt: '2026-10-04T12:00:00Z', completedAt: '2026-10-04T12:00:00Z',
          summary: 'Resumen de Edificio Sol', items: [],
        },
        processing: null,
      });
      await settle();
      h.fixture.detectChanges();
      expect(panel?.textContent).toContain('Resumen de Edificio Sol');
      expect(panel!.compareDocumentPosition(h.el.querySelector('.legacy-links')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      h.component.activeTab.set('properties');
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-intelligence-panel')).toBeNull();
    });

    it('no muestra selector ni apartados antes de cargar una finca', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-estate-community-selector')).toBeNull();
      expect(h.el.querySelector('.estate-subnav')).toBeNull();
      h.http.expectOne(`${API}/estates/e1`).flush(null);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-estate-community-selector')).toBeNull();
    });

    it('sin ?tab= abre el Resumen', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: '' }) });
      await flushInitialLoad(h);
      expect(h.component.activeTab()).toBe('summary');
      expect(h.el.querySelector('[data-estate-tab="summary"]')?.getAttribute('aria-current')).toBe('page');
      expect(h.el.querySelector('.estate-heading__section')?.textContent).toContain('Resumen');
    });

    it('muestra siempre las siete pestañas del diseño y conserva los contadores', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [makeProperty()], requests: [makeRequest()] });
      const nav = TestBed.inject(EstateNavigationService);
      const chips = Array.from(h.el.querySelectorAll('[data-estate-tab]')).map((el) => el.getAttribute('data-estate-tab'));
      expect(chips).toEqual(['summary', 'properties', 'amenities', 'providers', 'contracts', 'documents', 'general']);
      expect(h.el.querySelector('[data-estate-tab="properties"] .tab__count')?.textContent?.trim()).toBe('1');
      expect(h.el.querySelector('[data-estate-tab="properties"]')?.getAttribute('aria-current')).toBe('page');
      h.fixture.destroy();
      expect(nav.context()).toBeNull();
    });

    it('las secciones sin pestaña siguen accesibles desde el Resumen y se vuelve con "Volver al resumen"', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'summary' }) });
      await flushInitialLoad(h, { requests: [makeRequest()] });
      const links = Array.from(h.el.querySelectorAll('[data-legacy-link]')).map((el) => el.getAttribute('data-legacy-link'));
      // Juntas e Incidencias no aparecen: se llega a ellas desde el menú lateral.
      expect(links).toEqual(['requests', 'communications']);

      (h.el.querySelector('[data-legacy-link="requests"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.component.activeTab()).toBe('requests');
      expect(h.component.isLegacyTab()).toBe(true);
      expect(h.el.querySelector('[aria-current="page"][data-estate-tab]')).toBeNull();
      expect(h.el.querySelector('.estate-heading__section')?.textContent).toContain('Solicitudes de adhesión');
      expect(h.el.querySelector('app-adhesiones-tab')).not.toBeNull();

      (h.el.querySelector('[data-legacy-back]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.component.activeTab()).toBe('summary');
      expect(h.el.querySelector('[data-legacy-back]')).toBeNull();
    });

    it('"Ver propiedad" del Resumen abre la pestaña Propiedades con la edición de esa propiedad', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'summary' }) });
      await flushInitialLoad(h, { properties: [makeProperty({ id: 'p1' }), makeProperty({ id: 'p2', ref: '5B' })] });
      h.fixture.detectChanges();
      h.http.match((r) => r.url.endsWith('/dashboard/properties')).forEach((req) => req.flush({
        total: 2, items: [{ id: 'p2', ref: '5B', type: 'Piso', titular: 'Antonio', quotaMonthly: 100, balance: 0, openIssues: 0, status: 'ok' }],
      }));
      await settle();
      h.fixture.detectChanges();

      (h.el.querySelector('[data-property="p2"] .recent__open') as HTMLButtonElement).click();
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('properties');
      expect(h.el.querySelector('app-properties-tab .modal-backdrop')).not.toBeNull();
      expect(h.component.deepLinkPropertyId()).toBeNull(); // consumido por la pestaña
    });

    it('Datos generales muestra el acreedor SEPA con su carga diferida', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h);
      (h.el.querySelector('[data-estate-tab="general"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/sepa-billing`).flush(makeSepaBilling());
      await settle();
      h.fixture.detectChanges();
      expect(h.component.activeTab()).toBe('general');
      expect(h.el.querySelector('app-sepa-tab .billing-grid')).not.toBeNull();
      expect(h.el.querySelector('app-general-tab [data-card="community"]')).not.toBeNull();
      expect(h.el.querySelector('[data-estate-tab="general"]')?.getAttribute('aria-current')).toBe('page');
    });

    it('Datos generales es de solo lectura y «Ver historial de cargos» abre el historial', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'general' }) });
      await flushInitialLoad(h);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/sepa-billing`).flush(makeSepaBilling());
      h.http.expectOne(`${API}/estates/e1/general-overview`).flush({
        properties: 0, coefficients: { total: 0, informed: 0, missing: 0, max: null, min: null },
        surface: { parcelAreaM2: null, builtAreaM2: null, builtAreaInformed: 0 },
        fiscalYear: { year: 2026, startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'Abierto' },
        bank: null, administrator: null, offices: { president: null, vicePresidents: [] }, keyContacts: [], essentialDocuments: [], insurance: [],
      });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-general-tab .section-card__action')).toBeNull();
      (Array.from(h.el.querySelectorAll<HTMLButtonElement>('app-general-tab [data-card="offices"] button')).find((b) => b.textContent?.includes('Ver historial de cargos')))!.click();
      h.fixture.detectChanges();
      expect(h.component.showOfficeHistory()).toBe(true);
    });

    it('las incidencias de una instalación (desde el panel de Instalaciones) abren el listado de Incidencias filtrado por ella', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'summary' }) });
      await flushInitialLoad(h);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.component.openIssuesOf({ id: 'a1', name: 'Cubierta' });
      expect(navigate).toHaveBeenCalledWith(['/b/incidencias'], { queryParams: { estateId: 'e1', assetId: 'a1' } });
      expect(h.component.activeTab()).toBe('summary');
      h.http.match(() => true).forEach((req) => req.flush([]));
    });

    it('«Incidencias» desde el Resumen abre el listado de Incidencias de la comunidad, no una sección de la finca', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'summary' }) });
      await flushInitialLoad(h);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.component.selectTab('issues');
      expect(navigate).toHaveBeenCalledWith(['/b/incidencias'], { queryParams: { estateId: 'e1' } });
      expect(h.component.activeTab()).toBe('summary');
      h.http.match(() => true).forEach((req) => req.flush([]));
    });

    it('Contratos monta su pestaña, carga los contratos de la finca y, sin contratos, "Ir a Proveedores" lleva a Proveedores', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'contracts' }) });
      await flushInitialLoad(h);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/contracts`).flush([]);
      h.http.expectOne(`${API}/estates/e1/contracts/renewals`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contracts-tab')).not.toBeNull();

      (h.el.querySelector('app-contracts-tab .contracts__link') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.component.activeTab()).toBe('providers');
      h.http.match(() => true).forEach((req) => req.flush([]));
    });
  });

  describe('ngOnInit — carga inicial', () => {
    it('carga la finca, las propiedades y las solicitudes en paralelo', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, {
        estate: makeEstate({ name: 'Edificio Sol' }),
        properties: [makeProperty({ id: 'p1' })],
        requests: [makeRequest({ id: 'r1' })],
      });

      expect(h.component.estateData()?.name).toBe('Edificio Sol');
      expect(h.component.properties()).toHaveLength(1);
      expect(h.component.requests()).toHaveLength(1);
      expect(h.el.querySelector('.community-selector__name')?.textContent).toContain('Edificio Sol');
    });

    it('si la finca no existe, no continúa cargando propiedades/solicitudes', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { estate: null });

      expect(h.component.estateData()).toBeNull();
      expect(h.component.properties()).toHaveLength(0);
      h.http.expectNone((r) => r.url === `${API}/estates/e1/properties`);
    });

    it('sin :id en la ruta ni finca seleccionada en el StateService, no llama a la API', async () => {
      h = setupComponent(EstateDetailComponent, {
        providers: [
          { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } } },
        ],
      });
      h.fixture.detectChanges();
      await settle();

      h.http.expectNone(() => true);
    });
  });

  describe('deep link por query params (?tab=)', () => {
    async function openInstallations(tab: 'amenities' | 'inspections') {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab }) });
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1`).flush(makeEstate());
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/properties`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests`).flush([]);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/external-owners`).flush([]);
      await settle();
      h.fixture.detectChanges();
    }
    const flushPanel = async () => {
      h.http.expectOne((r) => r.url === `${API}/estates/e1/installations`).flush({ items: [], upcoming: [] });
      await settle();
      h.fixture.detectChanges();
    };
    const flushInspections = async () => {
      h.http.expectOne((r) => r.url === `${API}/estates/e1/inspections`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/assets`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/inspection-types`).flush([]);
      await settle();
      h.fixture.detectChanges();
    };

    it('?tab=amenities abre Instalaciones con el panel, y "Inspecciones" y "Zonas comunes" son sub-vistas', async () => {
      await openInstallations('amenities');
      await flushPanel();
      expect(h.component.activeTab()).toBe('amenities');
      expect(h.el.querySelector('app-installations-panel')).not.toBeNull();
      expect(h.el.querySelector('app-inspecciones-tab')).toBeNull();
      expect(h.el.querySelector('app-amenities-tab')).toBeNull();
      expect(Array.from(h.el.querySelectorAll('[data-installations-sub]')).map((b) => b.textContent?.trim())).toEqual(['Instalaciones', 'Inspecciones', 'Zonas comunes']);

      (h.el.querySelector('[data-installations-sub="inspections"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      await flushInspections();
      expect(h.el.querySelector('app-inspecciones-tab')).not.toBeNull();
      expect(h.el.querySelector('app-installations-panel')).toBeNull();

      (h.el.querySelector('[data-installations-sub="amenities"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/amenities`).flush([{ id: 'am1', estateId: 'e1', name: 'Piscina', maxHours: 2, slots: ['10:00'], capacity: 4, active: true }]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/amenities/bookings`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-inspecciones-tab')).toBeNull();
      expect(h.el.querySelectorAll('app-amenities-tab .amenity-row')).toHaveLength(1);
      expect(h.component.amenitiesCount()).toBe(1);
    });

    it('el enlace antiguo ?tab=inspections sigue funcionando: abre Instalaciones en inspecciones', async () => {
      await openInstallations('inspections');
      await flushInspections();
      expect(h.component.activeTab()).toBe('amenities');
      expect(h.component.isLegacyTab()).toBe(false);
      expect(h.el.querySelector('[data-estate-tab="amenities"]')?.getAttribute('aria-current')).toBe('page');
      expect(h.el.querySelector('app-inspecciones-tab')).not.toBeNull();
    });

    it('desde otra sección, selectTab("inspections") (hitos y actividad del Resumen) vuelve a la vista de inspecciones', async () => {
      await openInstallations('amenities');
      await flushPanel();
      (h.el.querySelector('[data-installations-sub="amenities"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.match((r) => r.url.includes('/amenities')).forEach((req) => req.flush([]));
      await settle();

      h.component.selectTab('inspections');
      h.fixture.detectChanges();
      await flushInspections();
      expect(h.component.installationsSubTab()).toBe('inspections');
      expect(h.el.querySelector('app-inspecciones-tab')).not.toBeNull();
    });

    it('?tab=sepa abre la pestaña Y carga los datos del acreedor', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'sepa' }) });
      await flushInitialLoad(h);
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/sepa-billing`).flush(makeSepaBilling());
      await settle();
      h.fixture.detectChanges();

      expect(h.component.activeTab()).toBe('sepa');
      expect(h.el.querySelector('app-sepa-tab')?.textContent).toContain('ES23000B00000000');
    });

    it('?action=edit-estate abre directamente el modal de editar finca', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'edit-estate' }) });
      await flushInitialLoad(h);

      expect(h.component.showEditEstate()).toBe(true);
    });

    it('?action=add-property abre el asistente de alta de propiedad', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'add-property' }) });
      await flushInitialLoad(h);

      expect(h.component.state.showAddPropertyModal()).toBe(true);
    });

    it('?action=import-catastro abre el modal de importación del Catastro', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'import-catastro' }) });
      await flushInitialLoad(h);
      h.http.match((r) => r.url.includes('/catastro/provinces')).forEach((req) => req.flush([]));

      expect(h.component.showCatastroImport()).toBe(true);
    });

    it('?action=open-setup abre el panel de puesta en marcha', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'open-setup' }) });
      await flushInitialLoad(h);

      expect(h.component.setupDrawerOpen()).toBe(true);
    });

    it('?action=office-history abre el «Historial de cargos» de la finca', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'office-history' }) });
      await flushInitialLoad(h);
      h.fixture.detectChanges();
      h.http.match((r) => r.url === `${API}/estates/e1/office-terms`).forEach((req) => req.flush([]));
      await settle();
      h.fixture.detectChanges();

      expect(h.component.showOfficeHistory()).toBe(true);
      expect(h.el.querySelector('app-office-history-dialog h4')?.textContent).toBe('Historial de cargos');
    });

    it('tras usar ?action= lo quita de la URL sin añadir historial', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { action: 'import-catastro' }) });
      const router = h.component.router;
      vi.spyOn(router, 'url', 'get').mockReturnValue('/b/estates/e1?tab=properties&action=import-catastro');
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await flushInitialLoad(h);
      h.http.match((r) => r.url.includes('/catastro/provinces')).forEach((req) => req.flush([]));

      expect(navigate).toHaveBeenCalledTimes(1);
      const [tree, extras] = navigate.mock.calls[0];
      expect(router.serializeUrl(tree as never)).toBe('/b/estates/e1?tab=properties');
      expect(extras).toEqual({ replaceUrl: true });
    });

    it('un ?tab= inválido se ignora y se queda en la pestaña por defecto', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1', { tab: 'algo-inexistente' }) });
      await flushInitialLoad(h);

      expect(h.component.activeTab()).toBe('summary');
    });
  });

  describe('pestaña Propiedades', () => {
    beforeEach(async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, {
        properties: [makeProperty({ id: 'p1', type: 'Piso', ref: '3A', floor: '3', door: 'A' })],
      });
    });

    it('renderiza la tabla de propiedades (en <app-properties-tab>)', () => {
      expect(h.el.querySelectorAll('app-properties-tab .table tbody tr')).toHaveLength(1);
      expect(h.el.querySelector('.td--mono')?.textContent).toContain('3A');
    });

    it('"Nueva propiedad" delega en StateService en vez de abrir su propio wizard', () => {
      h.component.openNewProperty();

      expect(h.component.state.addPropertyEstateContext()).toMatchObject({ id: 'e1', name: 'Edificio Sol' });
      expect(h.component.state.showAddPropertyModal()).toBe(true);
    });
  });

  describe('coeficiente de participación (integración con la API)', () => {
  it('el coeficiente llega como string desde la API y se resume formateado, con las propiedades que faltan', async () => {
    h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
    await flushInitialLoad(h, {
      properties: [
        makeProperty({ id: 'p1', ref: '1A', floor: '1', participationQuota: '2.50' as never }),
        makeProperty({ id: 'p2', ref: '2A', floor: '2', participationQuota: null }),
      ],
    });

    // La tabla ya no tiene columna de coeficiente: el valor formateado se ve en el resumen inferior.
    expect(h.el.textContent).toContain('Suma de coeficientes informados: 2,50 %');
    expect(h.el.textContent).toContain('1 propiedad sin coeficiente');
  });
  });

  describe('puesta en marcha', () => {
    // Sin banner automático ni "ocultar": el único punto de entrada es el
    // botón de cabecera, visible siempre que falte algo imprescindible —
    // sin estado que persistir ni nada que "recuperar".
    const incomplete = () => makeSetupStatus({
      complete: false, requiredDone: 1,
      steps: makeSetupStatus().steps.map((s) => (s.key === 'properties' ? s : { ...s, status: 'pending' as const })),
    });

    async function loadWith(status: EstateSetupStatus): Promise<void> {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/setup-status`).flush(status);
      await settle();
      h.fixture.detectChanges();
    }

    const headerTrigger = () => h.el.querySelector('.estate-header__actions .trigger') as HTMLButtonElement;
    const menuItem = (label: string) =>
      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.estate-header__actions [role="menuitem"]')).find((b) => b.textContent?.includes(label));

    it('con pasos pendientes, el botón «Acciones» de la cabecera avisa de cuántos faltan y ofrece «Puesta en marcha»', async () => {
      await loadWith(incomplete());

      expect(headerTrigger().getAttribute('aria-label')).toBe('Acciones, 3 pasos pendientes'); // 4 requeridos - 1 hecho
      expect(headerTrigger().querySelector('.trigger__count')?.textContent?.trim()).toBe('3');
      headerTrigger().click();
      h.fixture.detectChanges();
      expect(menuItem('Puesta en marcha')).toBeDefined();
      expect(h.el.querySelector('.setup-drawer')).toBeNull(); // cerrado hasta elegir la opción
    });

    it('con la finca completa, el menú no ofrece «Puesta en marcha»', async () => {
      await loadWith(makeSetupStatus());
      expect(headerTrigger().getAttribute('aria-label')).toBe('Acciones');
      headerTrigger().click();
      h.fixture.detectChanges();
      expect(menuItem('Puesta en marcha')).toBeUndefined();
      expect(menuItem('Editar finca')).toBeDefined();
    });

    it('elegir «Puesta en marcha» en el menú abre el panel lateral', async () => {
      await loadWith(incomplete());
      headerTrigger().click();
      h.fixture.detectChanges();
      menuItem('Puesta en marcha')!.click();
      h.fixture.detectChanges();
      expect(h.component.setupDrawerOpen()).toBe(true);
    });

    it('el botón abre un panel lateral con la información completa', async () => {
      await loadWith(incomplete());

      h.component.openSetupDrawer();
      h.fixture.detectChanges();

      const drawer = h.el.querySelector('.setup-drawer');
      expect(drawer).not.toBeNull();
      expect(drawer?.querySelector('app-estate-setup-card')?.textContent).toContain('1 de 4 pasos imprescindibles');
    });

    it('"Añadir CIF" desde el panel abre el modal de editar finca y, al guardar, se recalcula el estado', async () => {
      await loadWith(incomplete());
      h.component.openSetupDrawer();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.setup-drawer .setup-step__action')).find((b) => b.textContent?.includes('Añadir CIF')) as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.component.showEditEstate()).toBe(true);
      expect(h.component.setupDrawerOpen()).toBe(false); // una acción cierra el panel

      h.component.eeCif.set('H12345678');
      const promise = h.component.saveEditEstate();
      h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH').flush(makeEstate({ cif: 'H12345678' }));
      await promise;
      h.http.expectOne((r) => r.url === `${API}/estates/e1/setup-status`).flush(makeSetupStatus());
      await settle();
      h.fixture.detectChanges();

      expect(headerTrigger().getAttribute('aria-label')).toBe('Acciones'); // ya no queda nada pendiente
    });

    it('"Importar propietarios" desde el panel lleva al asistente de migración con la finca y el tipo ya elegidos', async () => {
      await loadWith(incomplete());
      h.component.openSetupDrawer();
      h.fixture.detectChanges();
      const navigate = vi.spyOn(h.component.router, 'navigate').mockResolvedValue(true);

      (Array.from(h.el.querySelectorAll('.setup-drawer .setup-step__action')).find((b) => b.textContent?.includes('Importar propietarios')) as HTMLButtonElement).click();
      h.fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/b/migracion'], {
        queryParams: { estateId: 'e1', entity: 'owner', returnTo: 'setup' },
      });
      expect(h.component.setupDrawerOpen()).toBe(false);
    });

    it('"Configurar SEPA" desde el panel abre la pestaña SEPA cargando sus datos', async () => {
      await loadWith(incomplete());
      h.component.openSetupDrawer();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.setup-drawer .setup-step__action')).find((b) => b.textContent?.includes('Configurar SEPA')) as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/sepa-billing`).flush(makeSepaBilling());
      await settle();

      expect(h.component.activeTab()).toBe('general');
    });

    it('cerrar el panel con la X simplemente lo cierra', async () => {
      await loadWith(incomplete());
      h.component.openSetupDrawer();
      h.fixture.detectChanges();

      (h.el.querySelector('.setup-drawer .close-btn') as HTMLButtonElement).click();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.setup-drawer')).toBeNull();
      expect(headerTrigger().getAttribute('aria-label')).toBe('Acciones, 3 pasos pendientes'); // sigue pendiente para la próxima
    });
  });

  describe('titulares de la tabla y "Añadir titular"', () => {
    const properties = () => [
      makeProperty({ id: 'p1', ref: '1A' }),
      makeProperty({ id: 'p2', ref: '2A' }),
      makeProperty({ id: 'p3', ref: '3A' }),
    ];

    it('sin titular con cuenta, muestra el titular importado; el promovido y el que ya tiene cuenta no se duplican', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, {
        properties: properties(),
        primaryContacts: { p2: { fullName: 'Luis Con Cuenta', roleType: 'Propietario' } },
        externalOwners: [
          makeExternalOwner({ id: 'eo1', propertyId: 'p1', fullName: 'Ana Importada' }),
          makeExternalOwner({ id: 'eo2', propertyId: 'p2', fullName: 'Luis Importado' }),
          makeExternalOwner({ id: 'eo3', propertyId: 'p3', fullName: 'Pepa Promovida', promotedToUserId: 'u9' }),
        ],
      });

      const cells = Array.from(h.el.querySelectorAll('.table tbody tr')).map((tr) => tr.querySelectorAll('td')[3].textContent?.trim());
      expect(cells).toEqual(['Ana Importada', 'Luis Con Cuenta', '—']);
    });

    it('al añadir un titular desde la pestaña, el padre recarga los titulares', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: properties() });
      const tab = h.fixture.debugElement.query(By.directive(PropertiesTabComponent)).componentInstance as PropertiesTabComponent;

      tab.openAddTitular(tab.properties()[0]);
      tab.atFullName.set('Ana Titular');
      const promise = tab.saveAddTitular();
      h.http.expectOne((r) => r.url === `${API}/properties/p1/external-owners` && r.method === 'POST')
        .flush(makeExternalOwner({ fullName: 'Ana Titular' }));
      await promise;

      await flushTitulares(h, 'e1', properties(), { externalOwners: [makeExternalOwner({ propertyId: 'p1', fullName: 'Ana Titular' })] });
      expect(h.component.titularByProperty()['p1']?.name).toBe('Ana Titular');
    });
  });

  describe('pestaña Solicitudes de adhesión', () => {
    beforeEach(async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { requests: [makeRequest({ id: 'r1', user: { fullName: 'Ana García', email: 'ana@test.com' } })] });
      h.component.activeTab.set('requests');
      h.fixture.detectChanges();
    });

    it('renderiza las tarjetas de solicitud', () => {
      expect(h.el.querySelectorAll('.request-card')).toHaveLength(1);
      expect(h.el.querySelector('.request-card__name')?.textContent).toContain('Ana García');
    });

    it('aprobar una solicitud la quita del listado del padre (contador de la pestaña)', async () => {
      const tab = h.el.querySelector('app-adhesiones-tab');
      expect(tab).not.toBeNull();
      const btn = Array.from(h.el.querySelectorAll('.request-card__actions app-btn button')).find((b) => b.textContent?.includes('Aprobar')) as HTMLButtonElement;
      btn.click();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests/r1/approve` && r.method === 'POST').flush(null);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.requests()).toHaveLength(0);
    });
  });

  describe('modal Editar finca', () => {
    beforeEach(async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { estate: makeEstate({ name: 'Edificio Sol', reserveTarget: 5000 }) });
    });

    describe('pestañas', () => {
      const tabs = () => Array.from(h.el.querySelectorAll<HTMLButtonElement>('.modal--estate-edit [role="tab"]'));
      const panel = (id: string) => h.el.querySelector<HTMLElement>(`.modal--estate-edit [role="tabpanel"][data-panel="${id}"]`)!;
      const open = () => { h.component.openEditEstate(); h.fixture.detectChanges(); };

      it('se abre en «General» con cuatro pestañas (las de la ficha) y cada campo en su pestaña', () => {
        open();
        expect(h.el.querySelector('.modal--estate-edit .estate-subnav .estate-subnav__indicator')).not.toBeNull();
        expect(tabs().map((t) => t.textContent?.trim())).toEqual(['General', 'Ubicación', 'Finanzas y contabilidad', 'Personalización']);
        expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
        expect(tabs()[0].classList).toContain('estate-subnav__item--active');
        expect(panel('general').hidden).toBe(false);
        expect(panel('location').hidden).toBe(true);
        expect(panel('finance').hidden).toBe(true);
        expect(panel('personalization').hidden).toBe(true);
        expect(panel('personalization').querySelector('app-estate-photo-field')).not.toBeNull();
        expect(panel('personalization').querySelector('[role="radiogroup"]')).not.toBeNull();
        expect(panel('general').querySelector('app-estate-photo-field')).toBeNull();
        expect(panel('general').querySelector('#ee-year-built')).not.toBeNull();
        expect(panel('location').querySelector('#ee-cadastral')).not.toBeNull();
        expect(panel('finance').querySelector('#ee-cif')).not.toBeNull();
        expect(panel('finance').querySelector('#ee-tax-regime')).not.toBeNull();
      });

      it('cambia de pestaña con clic y con las flechas, y al reabrir vuelve a «General»', () => {
        open();
        tabs()[2].click();
        h.fixture.detectChanges();
        expect(panel('finance').hidden).toBe(false);
        expect(panel('general').hidden).toBe(true);
        tabs()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        h.fixture.detectChanges();
        expect(h.component.eeTab()).toBe('personalization');
        tabs()[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        h.fixture.detectChanges();
        expect(h.component.eeTab()).toBe('general');
        expect(document.activeElement).toBe(tabs()[0]);
        tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        h.fixture.detectChanges();
        expect(h.component.eeTab()).toBe('personalization');
        h.component.closeEditEstate();
        open();
        expect(h.component.eeTab()).toBe('general');
      });

      it('una pestaña con un error lo señala aunque no esté abierta', () => {
        open();
        h.component.eeCif.set('12345678Z');
        h.fixture.detectChanges();
        expect(tabs()[2].querySelector('.ee-tab__alert')).not.toBeNull();
        expect(tabs()[2].getAttribute('aria-label')).toBe('Finanzas y contabilidad (hay un dato que revisar)');
        expect(tabs()[0].querySelector('.ee-tab__alert')).toBeNull();
      });

      it('si la referencia catastral no es válida, guardar lleva a su pestaña y no envía nada', async () => {
        open();
        h.component.eeCadastralReference.set('123');
        await h.component.saveEditEstate();
        h.http.expectNone((r) => r.method === 'PATCH');
        expect(h.component.eeTab()).toBe('location');
      });
    });

    it('abrir el modal precarga los datos de la finca', () => {
      h.component.openEditEstate();
      h.fixture.detectChanges();

      expect(h.component.eeName()).toBe('Edificio Sol');
      expect(h.component.eeReserveTarget()).toBe(5000);
      expect(h.el.querySelector('.modal-backdrop')).not.toBeNull();
    });

    it('guardar hace PATCH y refleja los cambios en la cabecera', async () => {
      h.component.openEditEstate();
      h.component.eeName.set('Edificio Sol Renovado');

      const promise = h.component.saveEditEstate();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ name: 'Edificio Sol Renovado' });
      req.flush(makeEstate({ name: 'Edificio Sol Renovado' }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showEditEstate()).toBe(false);
      expect(h.el.querySelector('.community-selector__name')?.textContent).toContain('Edificio Sol Renovado');
    });

    it('la descripción se precarga, se envía recortada y vaciarla la borra (null)', async () => {
      h.component.openEditEstate();
      expect(h.component.eeDescription()).toBe('');
      h.component.eeDescription.set('  Comunidad con piscina y garaje.  ');

      let promise = h.component.saveEditEstate();
      let req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body.description).toBe('Comunidad con piscina y garaje.');
      req.flush(makeEstate({ description: 'Comunidad con piscina y garaje.' }));
      await promise;

      h.component.openEditEstate();
      expect(h.component.eeDescription()).toBe('Comunidad con piscina y garaje.');
      h.component.eeDescription.set('   ');
      promise = h.component.saveEditEstate();
      req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body.description).toBeNull();
      req.flush(makeEstate({ description: null }));
      await promise;
    });

    it('datos generales: se precargan, se envían recortados y vaciarlos los borra (null); la normativa propone la LPH', async () => {
      h.component.openEditEstate();
      expect(h.component.eeApplicableLaw()).toBe('Ley de Propiedad Horizontal');
      expect([h.component.eeYearBuilt(), h.component.eeMainUse(), h.component.eeInternalRef(), h.component.eeTaxRegime(), h.component.eeNotes()]).toEqual([null, '', '', '', '']);
      h.component.eeYearBuilt.set(2001);
      h.component.eeMainUse.set('Residencial');
      h.component.eeInternalRef.set(' FIN-0001 ');
      h.component.eeTaxRegime.set(' Entidad en régimen de atribución de rentas ');
      h.component.eeNotes.set('  Revisar la cubierta.  ');

      let promise = h.component.saveEditEstate();
      let req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({
        yearBuilt: 2001, mainUse: 'Residencial', internalRef: 'FIN-0001', taxRegime: 'Entidad en régimen de atribución de rentas',
        applicableLaw: 'Ley de Propiedad Horizontal', notes: 'Revisar la cubierta.',
      });
      req.flush(makeEstate({ yearBuilt: 2001, mainUse: 'Residencial', internalRef: 'FIN-0001', taxRegime: 'Entidad en régimen de atribución de rentas', applicableLaw: 'Ley de Propiedad Horizontal', notes: 'Revisar la cubierta.' }));
      await promise;

      h.component.openEditEstate();
      expect([h.component.eeYearBuilt(), h.component.eeMainUse(), h.component.eeInternalRef(), h.component.eeNotes()]).toEqual([2001, 'Residencial', 'FIN-0001', 'Revisar la cubierta.']);
      h.component.eeYearBuilt.set(null);
      h.component.eeMainUse.set('');
      h.component.eeInternalRef.set(' ');
      h.component.eeTaxRegime.set('');
      h.component.eeApplicableLaw.set('');
      h.component.eeNotes.set('');
      promise = h.component.saveEditEstate();
      req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ yearBuilt: null, mainUse: null, internalRef: null, taxRegime: null, applicableLaw: null, notes: null });
      req.flush(makeEstate());
      await promise;
    });

    it('una normativa vaciada a propósito no se vuelve a rellenar con la LPH al reabrir', async () => {
      h.component.estateData.set(makeEstate({ name: 'Edificio Sol', reserveTarget: 5000, applicableLaw: null }));
      h.component.openEditEstate();
      expect(h.component.eeApplicableLaw()).toBe('');
    });

    it('un año de construcción fuera de rango no se envía y se avisa', async () => {
      h.component.openEditEstate();
      h.component.eeYearBuilt.set(3000);
      await h.component.saveEditEstate();
      h.http.expectNone((r) => r.method === 'PATCH');
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('El año de construcción debe estar entre 1500 y');
      expect(h.component.showEditEstate()).toBe(true);
    });

    it('los campos de siempre se siguen enviando igual junto a los nuevos', async () => {
      h.component.openEditEstate();
      const promise = h.component.saveEditEstate();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(Object.keys(req.request.body)).toEqual(expect.arrayContaining(['name', 'type', 'address', 'location', 'description', 'province', 'postalCode', 'cadastralReference', 'reserveTarget', 'color', 'cif']));
      expect(req.request.body).toMatchObject({ name: 'Edificio Sol', reserveTarget: 5000 });
      req.flush(makeEstate({ name: 'Edificio Sol' }));
      await promise;
    });

    it('el CIF se precarga, se envía en mayúsculas y vaciarlo lo borra (null)', async () => {
      h.component.openEditEstate();
      expect(h.component.eeCif()).toBe('');
      h.component.eeCif.set(' h1234567j ');

      let promise = h.component.saveEditEstate();
      let req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body.cif).toBe('H1234567J');
      req.flush(makeEstate({ cif: 'H1234567J' }));
      await promise;

      h.component.openEditEstate();
      expect(h.component.eeCif()).toBe('H1234567J');
      h.component.eeCif.set('');
      promise = h.component.saveEditEstate();
      req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toHaveProperty('cif', null);
      req.flush(makeEstate({ cif: null }));
      await promise;
    });

    it('un CIF con formato inválido muestra el error y deshabilita guardar', () => {
      h.component.openEditEstate();
      h.component.eeCif.set('12345678Z');
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Formato no válido');
      const save = Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Guardar cambios')) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });

    it('si falla el guardado sin motivo del backend, muestra el genérico y no cierra el modal en falso positivo', async () => {
      h.component.openEditEstate();

      const promise = h.component.saveEditEstate();
      // Sin `message` en el cuerpo (p. ej. un 500 sin manejar, o un corte de
      // red) — es el caso en el que SÍ corresponde el genérico, a
      // diferencia de un 400 de validación que trae el motivo real.
      h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.eeSaving()).toBe(false);
      expect(h.el.querySelector('.toast')?.textContent).toContain('No se pudo actualizar la finca');
    });

    // Bug reportado: "Añadir CIF" parecía fallar sin explicación. La causa
    // real nunca fue el formato del CIF (el botón "Guardar" ya se
    // deshabilita client-side para eso) — era que el catch de
    // saveEditEstate descartaba el motivo real que el backend SÍ manda
    // (p. ej. el de OTRO campo del mismo formulario) y mostraba siempre el
    // mismo genérico, sin pista de qué pasó.
    it('si el backend manda un motivo de validación concreto (p. ej. de OTRO campo del formulario), se lo muestra tal cual', async () => {
      h.component.openEditEstate();
      h.component.eeCif.set('H12345678');

      const promise = h.component.saveEditEstate();
      h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH')
        .flush({ message: ['name must be longer than or equal to 1 characters'], error: 'Bad Request', statusCode: 400 }, { status: 400, statusText: 'Bad Request' });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('name must be longer than or equal to 1 characters');
    });

    it('provincia, código postal y referencia catastral se precargan y se envían al guardar', async () => {
      h.component.openEditEstate();
      h.component.eeProvince.set('Madrid');
      h.component.eePostalCode.set('28009');
      h.component.eeCadastralReference.set(' 2853604vk4725d ');

      const promise = h.component.saveEditEstate();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ province: 'Madrid', postalCode: '28009', cadastralReference: '2853604VK4725D' });
      req.flush(makeEstate({ province: 'Madrid', postalCode: '28009', cadastralReference: '2853604VK4725D' }));
      await promise;
    });

    it('vaciar esos campos manda null (borra el dato), no undefined (que el backend ignoraría)', async () => {
      h.component.openEditEstate();

      const promise = h.component.saveEditEstate();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      expect(req.request.body).toHaveProperty('province', null);
      expect(req.request.body).toHaveProperty('postalCode', null);
      expect(req.request.body).toHaveProperty('cadastralReference', null);
      req.flush(makeEstate());
      await promise;
    });

    it('una referencia catastral que no tiene 14 caracteres se rechaza sin llamar a la API', async () => {
      h.component.openEditEstate();
      h.component.eeCadastralReference.set('123');

      await h.component.saveEditEstate();
      h.fixture.detectChanges();

      h.http.expectNone((r) => r.method === 'PATCH');
      expect(h.el.querySelector('.toast')?.textContent).toContain('14 caracteres');
      expect(h.component.showEditEstate()).toBe(true);
    });

    describe('foto de la finca', () => {
      const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'fachada.png', { type: 'image/png' });
      const patch = () => h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'PATCH');
      const photoReq = (method: string) => h.http.expectOne((r) => r.url === `${API}/estates/e1/photo` && r.method === method);

      it('el modal de edición incluye el campo "Foto de la finca"', () => {
        h.component.openEditEstate();
        h.fixture.detectChanges();
        expect(h.el.querySelector('.modal app-estate-photo-field [data-field="photo"]')).not.toBeNull();
        expect(h.component.eePhoto()).toEqual({ file: null, remove: false });
      });

      it('sin tocar la foto, guardar no hace ninguna petición de foto', async () => {
        h.component.openEditEstate();
        const promise = h.component.saveEditEstate();
        patch().flush(makeEstate());
        await promise;
        h.http.expectNone((r) => r.url.startsWith(`${API}/estates/e1/photo`));
      });

      it('con una foto elegida: primero guarda los datos y después sube la foto, y la finca ya trae la nueva versión', async () => {
        h.component.openEditEstate();
        h.component.eeName.set('Edificio Sol Renovado');
        h.component.eePhoto.set({ file: png(), remove: false });

        const promise = h.component.saveEditEstate();
        patch().flush(makeEstate({ name: 'Edificio Sol Renovado' }));
        await settle();
        const upload = photoReq('POST');
        expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);
        upload.flush(makeEstate({ name: 'Edificio Sol Renovado', photoUpdatedAt: '2026-10-17T10:00:00.000Z' }));
        await promise;
        h.fixture.detectChanges();

        expect(h.component.estateData()?.photoUpdatedAt).toBe('2026-10-17T10:00:00.000Z');
        expect(h.component.showEditEstate()).toBe(false);
        h.http.match((r) => r.method === 'GET' && r.url.startsWith(`${API}/estates/e1/photo`)).forEach((req) => req.flush(new Blob(['x'], { type: 'image/png' })));
      });

      it('"Quitar foto" hace DELETE al guardar', async () => {
        h.component.openEditEstate();
        h.component.eePhoto.set({ file: null, remove: true });
        const promise = h.component.saveEditEstate();
        patch().flush(makeEstate({ photoUpdatedAt: '2026-10-17T10:00:00.000Z' }));
        await settle();
        photoReq('DELETE').flush(makeEstate({ photoUpdatedAt: null }));
        await promise;
        expect(h.component.estateData()?.photoUpdatedAt).toBeNull();
        expect(h.component.showEditEstate()).toBe(false);
      });

      it('si falla la foto los datos ya están guardados: avisa y deja el formulario abierto para reintentar', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        h.component.openEditEstate();
        h.component.eeName.set('Edificio Sol Renovado');
        h.component.eePhoto.set({ file: png(), remove: false });
        const promise = h.component.saveEditEstate();
        patch().flush(makeEstate({ name: 'Edificio Sol Renovado' }));
        await settle();
        photoReq('POST').flush({ message: 'La foto debe ser una imagen JPG, PNG o WebP.' }, { status: 400, statusText: 'Bad Request' });
        await promise;

        expect(h.component.estateData()?.name).toBe('Edificio Sol Renovado'); // lo demás se guardó
        expect(h.component.showEditEstate()).toBe(true); // sigue abierto
        expect(h.component.toastMessage()).toContain('La finca se guardó, pero la foto no: La foto debe ser una imagen JPG, PNG o WebP.');
        expect(h.component.eePhoto()).toEqual({ file: null, remove: false }); // no se reintenta sola
      });

      it('un 413 del servidor (foto demasiado grande) se traduce a un mensaje claro', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        h.component.openEditEstate();
        h.component.eePhoto.set({ file: png(), remove: false });
        const promise = h.component.saveEditEstate();
        patch().flush(makeEstate());
        await settle();
        photoReq('POST').flush({ statusCode: 413, message: 'File too large' }, { status: 413, statusText: 'Payload Too Large' });
        await promise;
        expect(h.component.toastMessage()).toContain('supera el máximo de 5 MB');
      });

      it('reabrir el formulario olvida la foto elegida antes (Cancelar no sube nada)', async () => {
        h.component.openEditEstate();
        h.component.eePhoto.set({ file: png(), remove: false });
        h.component.closeEditEstate();
        h.component.openEditEstate();
        expect(h.component.eePhoto()).toEqual({ file: null, remove: false });
        h.http.expectNone((r) => r.url.startsWith(`${API}/estates/e1/photo`));
      });
    });
  });

  describe('importar desde el Catastro', () => {
    it('una finca sin propiedades ofrece importarlas desde el Catastro; el botón abre el modal (que carga las provincias)', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [] });

      const emptyButton = Array.from(h.el.querySelectorAll('.no-requests button')).find((b) => b.textContent?.includes('Catastro')) as HTMLButtonElement;
      expect(emptyButton).toBeDefined();
      emptyButton.click();
      h.fixture.detectChanges();

      expect(h.component.showCatastroImport()).toBe(true);
      h.http.expectOne(`${API}/catastro/provinces`).flush([{ code: '28', name: 'MADRID' }]);
      h.http.match((r) => r.url === `${API}/catastro/streets`).forEach((r) => r.flush([]));
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-catastro-import-modal .modal')).not.toBeNull();
    });

    it('mientras las propiedades aún se cargan no se muestra el estado vacío (evita el parpadeo de "0 propiedades")', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1`).flush(makeEstate());
      await settle();
      h.fixture.detectChanges();

      expect(h.component.properties()).toEqual([]);
      expect(h.el.querySelector('.no-requests')).toBeNull();

      // Termina la carga inicial (sin propiedades): ahora sí.
      h.http.expectOne((r) => r.url === `${API}/estates/e1/properties`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests`).flush([]);
      await settle();
      // loadTitulares (fire-and-forget): sin propiedades, solo pide los titulares externos de la finca.
      h.http.expectOne((r) => r.url === `${API}/estates/e1/external-owners`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.no-requests')).not.toBeNull();
    });

    it('con propiedades ya cargadas no se muestra el estado vacío, pero el menú de cabecera sigue ofreciendo importar', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [makeProperty()] });

      expect(h.el.querySelector('.no-requests')).toBeNull();
      (h.el.querySelector('.estate-header__actions .trigger') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      const headerItem = Array.from(h.el.querySelectorAll('.estate-header__actions [role="menuitem"]')).find((b) => b.textContent?.includes('Catastro'));
      expect(headerItem).toBeDefined();
    });

    it('al importar unidades recarga la tabla de propiedades y la finca (la importación puede rellenarle provincia/referencia)', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [] });

      const done = h.component.onCatastroImported({ created: 3, skipped: 0 });
      h.fixture.detectChanges();
      await settle();

      h.http.expectOne((r) => r.url === `${API}/estates/e1/properties` && r.method === 'GET')
        .flush([makeProperty({ id: 'n1' }), makeProperty({ id: 'n2' }), makeProperty({ id: 'n3' })]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'GET')
        .flush(makeEstate({ province: 'Madrid', cadastralReference: '2853604VK4725D' }));
      await done;
      await settle();
      // Las propiedades nuevas también piden su titular principal y los titulares externos de la finca (loadTitulares).
      h.http.expectOne((r) => r.url === `${API}/estates/e1/external-owners`).flush([]);
      h.http.match((r) => r.url.endsWith('/memberships/primary-contact')).forEach((r) => r.flush(null));
      await settle();

      expect(h.component.properties()).toHaveLength(3);
      expect(h.component.estate?.cadastralReference).toBe('2853604VK4725D');
    });

    it('si no se creó nada (todo omitido) no recarga las propiedades, solo la finca', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [] });

      const done = h.component.onCatastroImported({ created: 0, skipped: 5 });
      h.fixture.detectChanges();
      await settle();

      h.http.expectNone((r) => r.url === `${API}/estates/e1/properties`);
      h.http.expectOne((r) => r.url === `${API}/estates/e1` && r.method === 'GET').flush(makeEstate());
      await done;
    });

    it('cerrar el modal lo oculta', async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h, { properties: [] });

      h.component.openCatastroImport();
      h.component.closeCatastroImport();

      expect(h.component.showCatastroImport()).toBe(false);
    });
  });

  describe('pestañas de componentes hijos autosuficientes (presencia, sin probar su lógica interna)', () => {
    beforeEach(async () => {
      h = setupComponent(EstateDetailComponent, { providers: withRoute('e1') });
      await flushInitialLoad(h);
    });

    it('Documentos renderiza la biblioteca <app-library-tab>', async () => {
      h.component.activeTab.set('documents');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/library?folderId=root`)
        .flush({ folders: [], rootDocumentCount: 0, documents: [], pendingReview: 0, inTrash: 0 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-library-tab')).not.toBeNull();
    });

    it('Comunicados renderiza <app-comunicados-tab> con el estateId correcto', async () => {
      h.component.activeTab.set('communications');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/communications`).flush({ items: [], total: 0, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-comunicados-tab')).not.toBeNull();
    });

    const EMPTY_OVERVIEW = { kpis: { totalSuppliers: 0, activeContracts: 0, expiringContracts: 0, openIssues: 0 }, items: [], recentInterventions: [] };

    it('Proveedores y Personal renderiza el panel de proveedores por defecto', async () => {
      h.component.activeTab.set('providers');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/overview`).flush(EMPTY_OVERVIEW);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-suppliers-panel')).not.toBeNull();
      expect(h.el.querySelector('app-proveedores-tab')).toBeNull();
      expect(h.el.querySelector('app-personal-tab')).toBeNull();
    });

    it('«Facturas y pagos» conserva la vista de contabilidad de proveedores', async () => {
      h.component.activeTab.set('providers');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/overview`).flush(EMPTY_OVERVIEW);
      await settle();

      h.component.providersSubTab.set('billing');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents`).flush({ data: [], total: 0, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-proveedores-tab')).not.toBeNull();
      expect(h.el.querySelector('app-suppliers-panel')).toBeNull();
    });

    it('cambiar al subtab de Personal renderiza <app-personal-tab>', async () => {
      h.component.activeTab.set('providers');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/overview`).flush(EMPTY_OVERVIEW);
      await settle();

      h.component.providersSubTab.set('staff');
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-personal-tab')).not.toBeNull();
      expect(h.el.querySelector('app-suppliers-panel')).toBeNull();
    });
  });
});
