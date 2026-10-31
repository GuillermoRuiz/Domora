import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import type { CommunitySummary, PropertyOverview } from '../../core/owner-community.models';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { StateService } from '../../core/state.service';
import { CommunityCComponent } from './community-c.component';
import { fakeOwnerScope } from '../../core/testing/fake-owner-scope';

registerLocaleData(localeEs);

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24', estateId: 'e1', estateName: 'Colón 24', isLinked: true, estateIban: 'ES9121000418450200051332' };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: 'Calle Cuba 18', estateId: 'e2', estateName: 'Cuba 18', isLinked: true };
const LONE: ScopeProperty = { id: 'p4', nickname: 'Mi piso', addressFull: 'Calle X 1', estateId: null, estateName: null, isLinked: false };


describe('CommunityCComponent', () => {
  let h: ComponentHarness<CommunityCComponent>;

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }

  it('al abrir carga las propiedades del propietario', () => {
    const scope = fakeOwnerScope([P1]);
    mount(scope);
    expect(scope.load).toHaveBeenCalledTimes(1);
  });

  it('con propiedades muestra el título, el selector y el ámbito actual', () => {
    mount(fakeOwnerScope([P1, P2], { selectedId: 'p2' }));
    expect(h.el.querySelector('.community__title')?.textContent).toContain('Mi comunidad');
    expect(h.el.querySelector('app-topbar [slot=heading] app-community-scope-selector')).not.toBeNull();
    expect(h.el.querySelector('.community__header app-community-scope-selector')).toBeNull();
    expect(h.el.querySelector('.community__sub')?.textContent).toContain('Consulta el estado de tu comunidad, tus recibos, incidencias y documentos');
    expect(h.el.querySelector('[data-scope-chip]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Ámbito actual: Cuba 18');
    expect(h.el.querySelector('[data-empty]')).toBeNull();
  });

  it('las incidencias tienen su propio módulo: «Mi comunidad» no las lista ni las pide', () => {
    mount(fakeOwnerScope([P1]));
    expect(h.el.querySelector('app-community-issues')).toBeNull();
    h.http.expectNone((r) => r.url.includes('/issues'));
  });

  it('el ámbito de una propiedad sin finca lo dice', () => {
    mount(fakeOwnerScope([LONE]));
    expect(h.el.querySelector('[data-scope-chip]')?.textContent).toContain('Sin comunidad vinculada');
  });

  it('elegir otra propiedad en el selector cambia la propiedad que se visualiza', () => {
    const scope = fakeOwnerScope([P1, P2]);
    mount(scope);
    (h.el.querySelector('.scope__btn') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    (h.el.querySelector('[data-property="p2"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(scope.select).toHaveBeenCalledWith('p2');
    expect(h.el.querySelector('[data-scope-chip]')?.textContent).toContain('Cuba 18');
  });

  it('«Añadir propiedad» del selector abre el alta de propiedad', () => {
    mount(fakeOwnerScope([P1]));
    const state = TestBed.inject(StateService);
    expect(state.showAddPropertyModal()).toBe(false);
    (h.el.querySelector('.scope__btn') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    (h.el.querySelector('[data-action="add-property"]') as HTMLButtonElement).click();
    expect(state.showAddPropertyModal()).toBe(true);
  });

  it('sin ninguna propiedad ofrece añadirla o solicitar la vinculación desde aquí, y no enseña el selector', async () => {
    mount(fakeOwnerScope([]));
    await settle();
    expect(h.el.querySelector('[data-empty]')?.textContent).toContain('Todavía no tienes ninguna propiedad vinculada');
    expect(h.el.querySelector('app-community-scope-selector')).toBeNull();
    const state = TestBed.inject(StateService);
    (h.el.querySelector('[data-empty] button') as HTMLButtonElement).click();
    expect(state.showAddPropertyModal()).toBe(true);
  });

  it('mientras carga no enseña el estado vacío', () => {
    mount(fakeOwnerScope([], { loaded: false }));
    expect(h.el.textContent).toContain('Cargando…');
    expect(h.el.querySelector('[data-empty]')).toBeNull();
  });

  it('si falla la carga lo dice y no enseña el estado vacío', () => {
    mount(fakeOwnerScope([], { failed: true }));
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar tus propiedades');
    expect(h.el.querySelector('[data-empty]')).toBeNull();
  });

  it('recarga cuando se crea o se borra una propiedad (cambia la versión del estado)', async () => {
    const scope = fakeOwnerScope([P1]);
    mount(scope);
    const state = TestBed.inject(StateService);
    state.propertiesVersion.update(v => v + 1);
    h.fixture.detectChanges();
    await settle();
    expect(scope.load).toHaveBeenCalledTimes(2);
  });
});

describe('CommunityCComponent: fichas de la propiedad elegida', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const overviewUrl = (id: string) => `${API}/properties/${id}/my-overview`;
  const overview = (id: string, over: Partial<PropertyOverview> = {}): PropertyOverview => ({
    propertyId: id, estateId: 'e1', nextReceipt: { id: 'r1', concept: 'Cuota', amount: 125, dueDate: '2099-04-05', status: 'Pendiente' },
    requests: { open: 2, newLast30Days: 1 }, nextMeeting: null, documents: { newLast30Days: 3 }, ...over,
  });
  const kpiText = (id: string) => h.el.querySelector(`[data-kpi="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }
  async function flush(id: string, body: PropertyOverview | { status: number }) {
    const req = h.http.expectOne(overviewUrl(id));
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  it('pide las fichas de la propiedad elegida y las muestra', async () => {
    mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }));
    await flush('p1', overview('p1'));
    expect(kpiText('receipt')).toContain('125,00');
    expect(kpiText('requests')).toMatch(/2/);
  });

  it('mientras llegan los datos las fichas enseñan guiones', () => {
    mount(fakeOwnerScope([P1]));
    expect(kpiText('receipt')).toMatch(/—$/);
    h.http.expectOne(overviewUrl('p1'));
  });

  it('al cambiar de propiedad vuelve a pedir las fichas de la nueva', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' });
    mount(scope);
    await flush('p1', overview('p1'));
    scope.select('p2');
    h.fixture.detectChanges();
    await flush('p2', overview('p2', { nextReceipt: null, requests: { open: 0, newLast30Days: 0 } }));
    expect(kpiText('receipt')).toContain('Sin recibos pendientes');
    expect(kpiText('requests')).toContain('Ninguna nueva en 30 días');
  });

  it('una respuesta tardía de la propiedad anterior no pisa a la actual', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' });
    mount(scope);
    const first = h.http.expectOne(overviewUrl('p1'));
    scope.select('p2');
    h.fixture.detectChanges();
    const second = h.http.expectOne(overviewUrl('p2'));
    second.flush(overview('p2', { documents: { newLast30Days: 7 } }));
    await settle();
    first.flush(overview('p1', { documents: { newLast30Days: 1 } })); // llega tarde
    await settle();
    h.fixture.detectChanges();
    expect(kpiText('documents')).toContain('7');
  });

  it('si fallan las fichas lo dice y deja guiones; al cambiar de propiedad se reintenta', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' });
    mount(scope);
    await flush('p1', { status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los datos de tu propiedad');
    expect(kpiText('receipt')).toMatch(/—$/);
    scope.select('p2');
    h.fixture.detectChanges();
    await flush('p2', overview('p2'));
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('cada ficha lleva a su módulo: «Solicitudes abiertas» a Incidencias, el recibo a Recibos y pagos en la propiedad elegida', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p2' });
    mount(scope);
    await flush('p2', overview('p2'));
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="requests"]') as HTMLElement).click();
    (h.el.querySelector('[data-kpi="receipt"]') as HTMLElement).click();
    expect(navigate).toHaveBeenNthCalledWith(1, ['/c/incidencias'], { queryParams: { estateId: 'e2' } });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/c/recibos'], { queryParams: { propertyId: 'p2' } });
  });

  it('sin propiedades no pide nada ni enseña fichas', async () => {
    mount(fakeOwnerScope([]));
    await settle();
    expect(h.el.querySelector('app-community-kpis')).toBeNull();
    h.http.expectNone(r => r.url.includes('/my-overview'));
  });
});

describe('CommunityCComponent: resumen de la comunidad', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const summary = (id: string, name: string): CommunitySummary => ({
    id, name, type: 'Edificio', address: 'Calle Mayor, 1', postalCode: null, location: 'Madrid', province: null, description: null,
    photoUpdatedAt: null, catastroFacadeUrl: null, indicators: { owners: 24, activeIssues: 1, commonAreas: 'buen_estado' },
  });
  const overview = (id: string): PropertyOverview => ({ propertyId: id, estateId: 'e1', nextReceipt: null, requests: { open: 0, newLast30Days: 0 }, nextMeeting: null, documents: { newLast30Days: 0 } });

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }
  async function flush(url: string, body: object) {
    h.http.expectOne(`${API}${url}`).flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  it('pide el resumen de la finca de la propiedad elegida y lo muestra', async () => {
    mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }));
    await flush('/properties/p1/my-overview', overview('p1'));
    await flush('/estates/e1/community-summary', summary('e1', 'Colón 24'));
    expect(h.el.querySelector('.sum__name')?.textContent?.trim()).toBe('Colón 24');
  });

  it('al cambiar a una propiedad de otra finca pide el resumen de esa finca', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' });
    mount(scope);
    await flush('/properties/p1/my-overview', overview('p1'));
    await flush('/estates/e1/community-summary', summary('e1', 'Colón 24'));
    scope.select('p2');
    h.fixture.detectChanges();
    await flush('/properties/p2/my-overview', overview('p2'));
    await flush('/estates/e2/community-summary', summary('e2', 'Cuba 18'));
    expect(h.el.querySelector('.sum__name')?.textContent?.trim()).toBe('Cuba 18');
  });

  it('una propiedad sin finca no pide ningún resumen y ofrece solicitar la vinculación', async () => {
    mount(fakeOwnerScope([LONE]));
    h.http.expectOne(`${API}/properties/p4/my-overview`);
    h.http.expectNone(r => r.url.includes('community-summary'));
    expect(h.el.querySelector('[data-unlinked]')).not.toBeNull();
    (h.el.querySelector('[data-action="request-link"]') as HTMLButtonElement).click();
    expect(TestBed.inject(StateService).showAddPropertyModal()).toBe(true);
  });

  it('si falla el resumen lo dice sin romper las fichas', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flush('/properties/p1/my-overview', { ...overview('p1'), requests: { open: 2, newLast30Days: 0 } });
    h.http.expectOne(`${API}/estates/e1/community-summary`).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-community-summary [role="alert"]')?.textContent).toContain('No se pudo cargar el resumen');
    expect(h.el.querySelector('[data-kpi="requests"]')?.textContent).toContain('2');
  });

  it('«Ver detalles» abre la ficha completa de la propiedad elegida', async () => {
    mount(fakeOwnerScope([P1, P2], { selectedId: 'p2' }));
    await flush('/properties/p2/my-overview', overview('p2'));
    await flush('/estates/e2/community-summary', summary('e2', 'Cuba 18'));
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('app-community-summary .section-card__action') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/properties', 'p2']);
  });
});

describe('CommunityCComponent: recibos y pagos', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const raw = (id: string, over: Record<string, unknown> = {}) => ({
    id, no: `R-${id}`, propertyId: 'p1', period: { label: 'Octubre 2026', periodKey: '2026-10' }, amount: '125.00', outstanding: '125.00',
    concept: `Cuota ${id}`, kind: 'cuota_ordinaria', status: 'Pendiente', method: 'Transferencia', date: '2026-10-01', dueDate: '2026-10-05', ...over,
  });

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }
  async function flushReceipts(body: object[]) {
    h.http.expectOne(`${API}/users/u1/receipts`).flush(body);
    await settle();
    h.fixture.detectChanges();
  }
  const rowIds = () => Array.from(h.el.querySelectorAll('[data-receipt]')).map(r => r.getAttribute('data-receipt'));

  it('pide los recibos del usuario y enseña solo los de la propiedad elegida, sin anulados, el más reciente primero', async () => {
    mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }));
    const period = (key: string, label: string) => ({ period: { label, periodKey: key } });
    await flushReceipts([
      raw('a', period('2026-08', 'Agosto 2026')), raw('b', period('2026-10', 'Octubre 2026')), raw('c', period('2026-09', 'Septiembre 2026')),
      raw('otra', { propertyId: 'p2', ...period('2026-10', 'Octubre 2026') }), raw('anulado', { status: 'Anulado', ...period('2026-10', 'Octubre 2026') }),
    ]);
    expect(rowIds()).toEqual(['b', 'c', 'a']);
  });

  it('ordena por el PERIODO del recibo, no por su fecha de cobro: un recibo pendiente de octubre va antes que uno de septiembre cobrado hoy', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushReceipts([
      raw('sep', { period: { label: 'Septiembre 2026', periodKey: '2026-09' }, status: 'Pagada', outstanding: '0.00', date: '2026-10-18' }),
      raw('oct', { period: { label: 'Octubre 2026', periodKey: '2026-10' }, status: 'Pendiente', date: '2026-10-01' }),
    ]);
    expect(rowIds()).toEqual(['oct', 'sep']);
  });

  it('al cambiar de propiedad vuelve a pedir y filtra por la nueva', async () => {
    const scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' });
    mount(scope);
    await flushReceipts([raw('mio'), raw('suyo', { propertyId: 'p2' })]);
    expect(rowIds()).toEqual(['mio']);
    scope.select('p2');
    h.fixture.detectChanges();
    await flushReceipts([raw('mio'), raw('suyo', { propertyId: 'p2' })]);
    expect(rowIds()).toEqual(['suyo']);
  });

  it('«Pagar» abre las instrucciones de transferencia con el IBAN de la comunidad, el importe y el concepto', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushReceipts([raw('r1', { outstanding: '40.00', status: 'Parcial', concept: 'Cuota de octubre' })]);
    expect(h.el.querySelector('app-transfer-instructions-modal')).toBeNull();
    (h.el.querySelector('[data-action="pay"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const modal = h.el.querySelector('app-transfer-instructions-modal');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('ES91 2100 0418 4502 0005 1332');
    expect(modal?.textContent).toMatch(/40,00/);
    expect(modal?.textContent).toContain('Cuota de octubre');
  });

  it('«Pagar ahora» pide lo pendiente de toda la propiedad y el modal se cierra', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushReceipts([raw('a', { outstanding: '100.00' }), raw('b', { outstanding: '25.50' }), raw('c', { status: 'Pagada', outstanding: '0.00' })]);
    (h.el.querySelector('[data-action="pay-all"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-transfer-instructions-modal')?.textContent).toMatch(/125,50/);
    (h.el.querySelector('app-transfer-instructions-modal .close-btn') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-transfer-instructions-modal')).toBeNull();
  });

  it('una propiedad sin IBAN de comunidad sigue abriendo el modal (que avisa de que no hay datos)', async () => {
    mount(fakeOwnerScope([P2], { selectedId: 'p2' }));
    h.http.expectOne(`${API}/users/u1/receipts`).flush([raw('r1', { propertyId: 'p2' })]);
    await settle();
    h.fixture.detectChanges();
    (h.el.querySelector('[data-action="pay"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-transfer-instructions-modal')).not.toBeNull();
  });

  it('«Ver todos» abre Recibos y pagos en la propiedad elegida', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushReceipts([raw('r1')]);
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('app-community-receipts .section-card__action') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/recibos'], { queryParams: { propertyId: 'p1' } });
  });

  it('si falla la carga de recibos lo dice sin romper el resto', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    h.http.expectOne(`${API}/users/u1/receipts`).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-community-receipts [role="alert"]')?.textContent).toContain('No se pudieron cargar tus recibos');
    expect(h.el.querySelector('app-community-kpis')).not.toBeNull();
  });
});

describe('CommunityCComponent: actividad y eventos', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const P1B: ScopeProperty = { id: 'p1b', nickname: 'P03', addressFull: 'Calle Colón 24 Plaza 3', estateId: 'e1', estateName: 'Colón 24', isLinked: true };

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }
  const activity = (id: string, propertyId: string, over: Record<string, unknown> = {}) => ({ id, type: 'recibo', title: `T ${id}`, description: 'd', date: '2026-10-01T00:00:00.000Z', propertyId, ...over });
  const flushAll = async (opts: { events?: object[]; activity?: object[] } = {}) => {
    h.http.match(r => r.url.includes('/my-overview')).forEach(r => r.flush({ propertyId: 'p1', estateId: 'e1', nextReceipt: null, requests: { open: 0, newLast30Days: 0 }, nextMeeting: null, documents: { newLast30Days: 0 } }));
    h.http.match(r => r.url.includes('/community-summary')).forEach(r => r.flush({ id: 'e1', name: 'Colón 24', type: 'Edificio', address: 'x', postalCode: null, location: 'y', province: null, description: null, photoUpdatedAt: null, catastroFacadeUrl: null, indicators: { owners: 1, activeIssues: 0, commonAreas: 'buen_estado' } }));
    h.http.match(r => r.url.endsWith('/receipts')).forEach(r => r.flush([]));
    h.http.match(r => r.url.includes('/my-events')).forEach(r => r.flush(opts.events ?? []));
    h.http.match(r => r.url.includes('/activity')).forEach(r => r.flush(opts.activity ?? []));
    await settle();
    h.fixture.detectChanges();
  };
  const activityIds = () => Array.from(h.el.querySelectorAll('[data-activity]')).map(e => e.getAttribute('data-activity'));

  it('pide los próximos eventos de la propiedad elegida y los muestra', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    expect(h.http.match(r => r.url.endsWith('/properties/p1/my-events'))).toHaveLength(1);
    h.http.match(() => true);
    await settle();
  });

  it('muestra los eventos que llegan', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushAll({ events: [{ id: 'junta:1', kind: 'junta', title: 'Junta ordinaria', subtitle: 'Salón', date: '2026-10-30', time: '18:00' }] });
    expect(h.el.querySelector('[data-event="junta:1"]')).not.toBeNull();
  });

  it('de la actividad se queda con lo de las propiedades del usuario en esa finca (y lo que no trae propiedad), no con lo de otras fincas', async () => {
    mount(fakeOwnerScope([P1, P1B, P2], { selectedId: 'p1' }));
    await flushAll({ activity: [activity('a', 'p1'), activity('b', 'p2'), activity('c', 'p1b'), activity('d', '', { type: 'documento' })] });
    expect(activityIds()).toEqual(['a', 'c', 'd']);
  });

  it('la actividad de una propiedad sin finca es solo la suya', async () => {
    mount(fakeOwnerScope([LONE, P1], { selectedId: 'p4' }));
    await flushAll({ activity: [activity('mia', 'p4'), activity('otra', 'p1')] });
    expect(activityIds()).toEqual(['mia']);
  });

  it('pide más actividad de la que enseña, porque el feed mezcla todas las fincas', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    const req = h.http.expectOne(r => r.url.includes('/activity'));
    expect(req.request.params.get('limit')).toBe('40');
    h.http.match(() => true);
  });

  it('abrir una actividad de incidencia lleva a su detalle en la página de incidencias; la de recibo, a la pestaña de la propiedad', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushAll({ activity: [
      activity('receipt:r1', 'p1'),
      activity('issue:i1', 'p1', { type: 'incidencia' }),
      activity('i-sin-id', 'p1', { type: 'incidencia' }),
    ] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-activity="issue:i1"]') as HTMLButtonElement).click();
    (h.el.querySelector('[data-activity="i-sin-id"]') as HTMLButtonElement).click();
    (h.el.querySelector('[data-activity="receipt:r1"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenNthCalledWith(1, ['/c/incidencias'], { queryParams: { issue: 'i1' } });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/c/incidencias'], { queryParams: {} });
    expect(navigate).toHaveBeenNthCalledWith(3, ['/c/recibos'], { queryParams: { propertyId: 'p1' } });
  });

  it('abrir una actividad de documento lo abre en la página de Documentación', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushAll({ activity: [activity('document:d1', '', { type: 'documento' })] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-activity="document:d1"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/documentacion'], { queryParams: { doc: 'd1' } });
  });

  it('«Ver todas» lleva a la actividad completa', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushAll({ activity: [activity('r', 'p1')] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('app-community-activity .section-card__action') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/activity']);
  });

  it('un evento de junta lleva a la pestaña de juntas y uno de revisión no lleva a ninguna parte', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushAll({ events: [
      { id: 'junta:1', kind: 'junta', title: 'Junta', subtitle: null, date: '2026-10-30', time: null },
      { id: 'revision:x', kind: 'revision', title: 'RITE', subtitle: 'Caldera', date: '2026-10-31', time: null },
    ] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-event="revision:x"]') as HTMLButtonElement).click();
    expect(navigate).not.toHaveBeenCalled();
    (h.el.querySelector('[data-event="junta:1"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/juntas'], { queryParams: { propertyId: 'p1' } });
  });

  it('si fallan los eventos o la actividad lo dice en su tarjeta sin romper las demás', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    h.http.match(r => r.url.includes('/my-events')).forEach(r => r.flush({ message: 'x' }, { status: 500, statusText: 'Error' }));
    h.http.match(r => r.url.includes('/activity')).forEach(r => r.flush({ message: 'x' }, { status: 500, statusText: 'Error' }));
    h.http.match(() => true);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-community-events [role="alert"]')).not.toBeNull();
    expect(h.el.querySelector('app-community-activity [role="alert"]')).not.toBeNull();
    expect(h.el.querySelector('app-community-kpis')).not.toBeNull();
  });
});

describe('CommunityCComponent: documentos y accesos rápidos', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const rawDoc = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Doc ${id}`, type: 'Otro', date: '2026-10-01', size: '10 KB', targetPropertyId: null, isNew: false, ...over });
  const meeting = (id: string, over: Record<string, unknown> = {}) => ({ id, estateId: 'e1', title: 'Junta', status: 'firmada', scheduledAt1: '2026-08-01T17:00:00.000Z', scheduledAt2: '2026-08-01T17:30:00.000Z', actaS3Key: 'k', ...over });

  function mount(scope: ReturnType<typeof fakeOwnerScope>) {
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
  }
  async function flushData(opts: { documents?: object[]; meetings?: object[]; documentsFail?: boolean } = {}) {
    const emptyOverview = { propertyId: 'p1', estateId: 'e1', nextReceipt: null, requests: { open: 0, newLast30Days: 0 }, nextMeeting: null, documents: { newLast30Days: 0 } };
    const emptySummary = { id: 'e1', name: 'Colón 24', type: 'Edificio', address: 'x', postalCode: null, location: 'y', province: null, description: null, photoUpdatedAt: null, catastroFacadeUrl: null, indicators: { owners: 1, activeIssues: 0, commonAreas: 'buen_estado' } };
    h.http.match(r => r.url.includes('/my-overview')).forEach(r => r.flush(emptyOverview));
    h.http.match(r => r.url.includes('/community-summary')).forEach(r => r.flush(emptySummary));
    h.http.match(r => r.url.includes('/my-events') || r.url.includes('/activity') || r.url.endsWith('/receipts')).forEach(r => r.flush([]));
    h.http.match(r => r.url.includes('/documents') && !r.url.includes('/file')).forEach(r => {
      if (opts.documentsFail) r.flush({ message: 'x' }, { status: 500, statusText: 'Error' });
      else r.flush({ items: opts.documents ?? [], total: (opts.documents ?? []).length, page: 1, pageSize: 12 });
    });
    h.http.match(r => r.url.includes('/meetings')).forEach(r => r.flush(opts.meetings ?? []));
    await settle();
    h.fixture.detectChanges();
  }
  const docIds = () => Array.from(h.el.querySelectorAll('[data-document]')).map(e => e.getAttribute('data-document'));
  const quick = (id: string) => h.el.querySelector(`[data-quick="${id}"]`) as HTMLButtonElement;

  /** Intercepta la descarga del navegador y devuelve los nombres con los que se guardaría. */
  function captureDownloads(): string[] {
    const names: string[] = [];
    Object.assign(URL, { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    return names;
  }

  it('pide los documentos de la finca y enseña los generales y los dirigidos a ESTA propiedad, no los de otra', async () => {
    mount(fakeOwnerScope([P1, { id: 'p1b', nickname: 'P03', addressFull: 'Calle Colón 24 Plaza 3', estateId: 'e1', estateName: 'Colón 24', isLinked: true }], { selectedId: 'p1' }));
    await flushData({ documents: [rawDoc('gen'), rawDoc('mio', { targetPropertyId: 'p1' }), rawDoc('otro', { targetPropertyId: 'p1b' })] });
    expect(docIds()).toEqual(['gen', 'mio']);
  });

  it('una propiedad sin finca no pide documentos ni actas', async () => {
    mount(fakeOwnerScope([LONE], { selectedId: 'p4' }));
    h.http.expectNone(r => r.url.includes('/documents'));
    h.http.expectNone(r => r.url.includes('/meetings'));
    await flushData();
  });

  it('descargar un documento lo guarda con su nombre y la extensión de su tipo', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ documents: [rawDoc('d1', { title: 'Presupuesto 2027' })] });
    const names = captureDownloads();
    (h.el.querySelector('[data-document="d1"] [data-action="download"]') as HTMLButtonElement).click();
    h.http.expectOne(r => r.url.endsWith('/documents/d1/file')).flush(new Blob(['%PDF-'], { type: 'application/pdf' }));
    await settle();
    expect(names).toEqual(['Presupuesto 2027.pdf']);
    vi.restoreAllMocks();
  });

  it('si falla la descarga de un documento lo dice con su título', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ documents: [rawDoc('d1', { title: 'Estatutos' })] });
    (h.el.querySelector('[data-document="d1"] [data-action="download"]') as HTMLButtonElement).click();
    h.http.expectOne(r => r.url.endsWith('/documents/d1/file')).error(new ProgressEvent('error'), { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-action-error]')?.textContent).toContain('No se pudo descargar "Estatutos"');
  });

  it('si fallan los documentos lo dice en su tarjeta', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ documentsFail: true });
    expect(h.el.querySelector('app-community-documents [role="alert"]')).not.toBeNull();
  });

  it('«Ver todos» de documentos abre la página de Documentación', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ documents: [rawDoc('d1')] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('app-community-documents .section-card__action') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/documentacion']);
  });

  it('pulsar un documento reciente lo abre en la página de Documentación', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ documents: [rawDoc('d1')] });
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-document="d1"] [data-action="open"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/documentacion'], { queryParams: { doc: 'd1' } });
    h.http.expectNone(r => r.url.endsWith('/documents/d1/file'));
  });

  it('la ficha «Documentos nuevos» abre Documentación con solo los nuevos', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData();
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="documents"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/documentacion'], { queryParams: { onlyNew: '1' } });
  });

  it('los accesos rápidos llevan a la ficha de incidencias, mensajes y recibos', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData();
    const navigate = vi.spyOn(h.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    quick('issue').click(); // se queda en esta pantalla (la ficha de incidencias): no navega
    quick('message').click();
    quick('receipts').click();
    expect(navigate).toHaveBeenNthCalledWith(1, ['/c/incidencias'], { queryParams: { new: '1', estateId: 'e1' } });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/c/messages']);
    expect(navigate).toHaveBeenNthCalledWith(3, ['/c/recibos'], { queryParams: { propertyId: 'p1' } });
  });

  it('«Descargar acta» baja el acta de la última junta celebrada que la tiene (no de una convocada, ni sin acta)', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ meetings: [
      meeting('vieja', { scheduledAt1: '2026-01-01T17:00:00.000Z' }),
      meeting('reciente', { scheduledAt1: '2026-08-01T17:00:00.000Z' }),
      meeting('sin-acta', { scheduledAt1: '2026-09-01T17:00:00.000Z', actaS3Key: null }),
      meeting('convocada', { status: 'convocada', scheduledAt1: '2026-10-30T17:00:00.000Z' }),
    ] });
    expect(quick('acta').disabled).toBe(false);
    const names = captureDownloads();
    quick('acta').click();
    h.http.expectOne(r => r.url.endsWith('/meetings/reciente/acta.docx')).flush(new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    await settle();
    expect(names).toEqual(['Acta de la última junta.docx']);
    vi.restoreAllMocks();
  });

  it('sin ninguna acta firmada el acceso queda desactivado', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ meetings: [meeting('m1', { actaS3Key: null }), meeting('m2', { status: 'convocada' })] });
    expect(quick('acta').disabled).toBe(true);
    expect(quick('acta').textContent).toContain('Sin acta disponible');
  });

  it('si falla la descarga del acta lo dice', async () => {
    mount(fakeOwnerScope([P1], { selectedId: 'p1' }));
    await flushData({ meetings: [meeting('m1')] });
    quick('acta').click();
    h.http.expectOne(r => r.url.endsWith('/meetings/m1/acta.docx')).error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-action-error]')?.textContent).toContain('No se pudo descargar el acta');
  });
});

describe('CommunityCComponent: todas mis propiedades', () => {
  let h: ComponentHarness<CommunityCComponent>;
  const P1B: ScopeProperty = { id: 'p1b', nickname: 'P03', addressFull: 'Calle Colón 24 Plaza 3', estateId: 'e1', estateName: 'Colón 24', isLinked: true, estateIban: 'ES9121000418450200051332' };
  const ALL_OVERVIEW: PropertyOverview = {
    propertyId: null, estateId: null,
    nextReceipt: { id: 'r2', propertyId: 'p2', concept: 'Cuota', amount: 40, dueDate: '2099-04-01', status: 'Pendiente' },
    requests: { open: 3, newLast30Days: 2, newPrevious30Days: 1 }, nextMeeting: null, documents: { newLast30Days: 5 },
  };
  const receipt = (id: string, propertyId: string) => ({
    id, no: `R-${id}`, propertyId, period: { label: 'Octubre 2026', periodKey: '2026-10' }, amount: '50.00', outstanding: '50.00',
    concept: `Cuota ${id}`, kind: 'cuota_ordinaria', status: 'Pendiente', method: 'Transferencia', date: '2026-10-01', dueDate: '2026-10-05',
  });
  const event = (id: string, date: string) => ({ id, kind: 'junta', title: `Junta ${id}`, subtitle: null, date, time: '18:00' });
  const doc = (id: string, date: string, targetPropertyId: string | null = null) => ({ id, title: `Doc ${id}`, type: 'Otro', date, size: '1 KB', targetPropertyId, isNew: false });

  function mount(items: ScopeProperty[] = [P1, P1B, P2]) {
    const scope = fakeOwnerScope(items, { selectedId: null });
    h = setupComponent(CommunityCComponent, { user: makeUser(), providers: [{ provide: OwnerScopeService, useValue: scope }] });
    h.fixture.detectChanges();
    return scope;
  }
  async function flushAll() {
    h.http.expectOne(`${API}/properties/my-overview`).flush(ALL_OVERVIEW);
    h.http.expectOne(`${API}/users/u1/receipts`).flush([receipt('a', 'p1'), receipt('b', 'p2'), receipt('ajeno', 'p9')]);
    h.http.expectOne(`${API}/properties/p1/my-events`).flush([event('j1', '2099-01-10'), event('x', '2099-01-20')]);
    h.http.expectOne(`${API}/properties/p1b/my-events`).flush([event('j1', '2099-01-10')]);
    h.http.expectOne(`${API}/properties/p2/my-events`).flush([event('y', '2099-01-05')]);
    h.http.match(r => r.url.includes('/activity')).forEach(r => r.flush([]));
    h.http.expectOne(r => r.url.startsWith(`${API}/estates/e1/documents`)).flush({ items: [doc('gen1', '2026-10-01'), doc('mio', '2026-10-03', 'p1b'), doc('vecino', '2026-10-04', 'p7')], total: 3, page: 1, pageSize: 12 });
    h.http.expectOne(r => r.url.startsWith(`${API}/estates/e2/documents`)).flush({ items: [doc('gen2', '2026-10-02')], total: 1, page: 1, pageSize: 12 });
    h.http.expectNone(r => r.url.includes('/community-summary'));
    await settle();
    h.fixture.detectChanges();
  }
  const ids = (attr: string) => Array.from(h.el.querySelectorAll(`[${attr}]`)).map(e => e.getAttribute(attr));

  it('pide las fichas agregadas y lo dice en el ámbito y en el selector', async () => {
    mount();
    await flushAll();
    expect(h.el.querySelector('[data-scope-chip]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Ámbito actual: Todas mis propiedades');
    expect(h.el.querySelector('.scope__name')?.textContent?.trim()).toBe('Todas mis propiedades');
    expect(h.el.querySelector('[data-kpi="receipt"]')?.textContent).toContain('40,00');
    expect(h.el.querySelector('[data-kpi="requests"]')?.textContent).toContain('+1 vs. mes anterior');
  });

  it('enseña los recibos de todas sus propiedades con el nombre de cada una, sin los ajenos', async () => {
    mount();
    await flushAll();
    expect(ids('data-receipt').sort()).toEqual(['a', 'b']);
    expect(h.el.querySelector('[data-receipt="b"]')?.textContent).toContain('1A');
    expect(h.el.querySelector('[data-action="pay-all"]')).toBeNull(); // cada finca tiene su IBAN
  });

  it('«Pagar» un recibo usa el IBAN de la finca de SU propiedad', async () => {
    mount();
    await flushAll();
    (h.el.querySelector('[data-receipt="a"] [data-action="pay"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-transfer-instructions-modal')?.textContent).toContain('ES91');
  });

  it('une los eventos de todas sus propiedades sin repetir los de una misma finca, el más cercano primero', async () => {
    mount();
    await flushAll();
    expect(ids('data-event')).toEqual(['y', 'j1', 'x']);
    // Con varias fincas, cada evento dice de qué comunidad es (dos juntas el mismo día no se confunden).
    expect(h.el.querySelector('[data-event="y"]')?.textContent).toContain('Cuba 18');
    expect(h.el.querySelector('[data-event="j1"]')?.textContent).toContain('Colón 24');
  });

  it('une los documentos de todas sus fincas: los generales y los dirigidos a una de SUS propiedades, el más reciente primero', async () => {
    mount();
    await flushAll();
    expect(ids('data-document')).toEqual(['mio', 'gen2', 'gen1']);
  });

  it('en lugar del resumen de una finca lista sus comunidades; elegir una pasa a su primera propiedad', async () => {
    const scope = mount();
    await flushAll();
    expect(ids('data-community')).toEqual(['e1', 'e2']);
    expect(h.el.querySelector('[data-community="e1"]')?.textContent).toContain('2 propiedades');
    (h.el.querySelector('[data-community="e2"]') as HTMLButtonElement).click();
    expect(scope.select).toHaveBeenCalledWith('p2');
  });

  it('la próxima junta abre Juntas en «Todas», sin pedir propiedad', async () => {
    mount();
    await flushAll();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="meeting"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/c/juntas'], { queryParams: {} });
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('«Solicitudes abiertas» y «Nueva incidencia» van a la página de incidencias sin pedir propiedad', async () => {
    mount();
    await flushAll();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="requests"]') as HTMLButtonElement).click();
    (h.el.querySelector('[data-quick="issue"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    // En «Todas» no se acota a ninguna comunidad: el módulo de Incidencias pregunta en cuál se avisa.
    expect(navigate).toHaveBeenNthCalledWith(1, ['/c/incidencias'], { queryParams: {} });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/c/incidencias'], { queryParams: { new: '1' } });
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('los documentos van a la página de Documentación sin pedir propiedad', async () => {
    mount();
    await flushAll();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="documents"]') as HTMLButtonElement).click();
    (h.el.querySelector('app-community-documents .section-card__action') as HTMLButtonElement).click();
    (h.el.querySelector('[data-document="gen1"] [data-action="open"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(navigate).toHaveBeenNthCalledWith(1, ['/c/documentacion'], { queryParams: { onlyNew: '1' } });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/c/documentacion']);
    expect(navigate).toHaveBeenNthCalledWith(3, ['/c/documentacion'], { queryParams: { doc: 'gen1' } });
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('el próximo recibo abre Recibos y pagos en «Todas»', async () => {
    mount();
    await flushAll();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-kpi="receipt"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/c/recibos'], { queryParams: {} });
  });

  it('elegir después una propiedad vuelve a sus fichas', async () => {
    const scope = mount();
    await flushAll();
    scope.select('p2');
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/properties/p2/my-overview`);
  });
});
