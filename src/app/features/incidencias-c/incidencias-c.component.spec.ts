import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import type { TestRequest } from '@angular/common/http/testing';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { OwnerScopeService, type ScopeGroup, type ScopeProperty } from '../../core/owner-scope.service';
import { StateService } from '../../core/state.service';
import { IncidenciasCComponent } from './incidencias-c.component';
import { issueDetail, issueItem, issueList } from './testing/owner-issue-fixtures';

registerLocaleData(localeEs);

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24', estateId: 'e1', estateName: 'Colón 24', isLinked: true };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: 'Calle Cuba 18', estateId: 'e2', estateName: 'Cuba 18', isLinked: true };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** A scope service the test controls (the real one has its own tests). */
function fakeScope(items: ScopeProperty[], opts: { selectedId?: string | null; loaded?: boolean } = {}) {
  const selectedId = signal<string | null>(opts.selectedId !== undefined ? opts.selectedId : items[0]?.id ?? null);
  const showAll = () => items.length > 1;
  const isAll = () => showAll() && !items.some((p) => p.id === selectedId());
  const groups = (): ScopeGroup[] => items.map((p) => ({ estateId: p.estateId, estateName: p.estateName ?? 'Sin comunidad vinculada', properties: [p] }));
  return {
    items: signal(items),
    loaded: signal(opts.loaded ?? true),
    failed: signal(false),
    showAll,
    isAll,
    selected: () => (isAll() ? null : items.find((p) => p.id === selectedId()) ?? null),
    groups,
    load: vi.fn(async () => undefined),
    select: vi.fn((id: string | null) => selectedId.set(id)),
  };
}

describe('IncidenciasCComponent', () => {
  let h: ComponentHarness<IncidenciasCComponent>;
  let params: BehaviorSubject<ParamMap>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function mount(scope = fakeScope([P1, P2], { selectedId: 'p1' }), query: Record<string, string> = {}) {
    params = new BehaviorSubject(convertToParamMap(query));
    h = setupComponent(IncidenciasCComponent, {
      user: makeUser({ id: 'u1' }),
      providers: [
        { provide: OwnerScopeService, useValue: scope },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    await settle();
    return scope;
  }

  function listRequest(): TestRequest {
    return h.http.expectOne((r) => r.url === `${API}/me/issues`);
  }

  async function render() {
    await settle();
    h.fixture.detectChanges();
  }

  async function flushList(list = issueList()) {
    const req = listRequest();
    req.flush(list);
    await render();
    return req;
  }

  afterEach(() => h?.http.verify());

  it('loads the owner properties and shows the header with the current community and the new-issue button', async () => {
    const scope = await mount();
    await flushList();
    expect(scope.load).toHaveBeenCalledTimes(1);
    expect(h.el.querySelector('app-topbar [slot=heading] app-community-scope-selector')).not.toBeNull();
    expect(text(h.el.querySelector('h1'))).toBe('Incidencias');
    expect(text(h.el.querySelector('.issues__sub'))).toBe('Comunica incidencias en tu comunidad y haz seguimiento de su estado. Las incidencias son de la comunidad, no de tu vivienda.');
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: Colón 24');
    expect(text(h.el.querySelector('[data-action="new-issue"]'))).toBe('Nueva incidencia');
  });

  it('the list follows the scope: a property filters by its community, «Todas» does not; no home is ever sent', async () => {
    const scope = await mount();
    const first = listRequest();
    expect(first.request.params.get('estateId')).toBe('e1');
    expect(first.request.params.has('propertyId')).toBe(false);
    first.flush(issueList());
    await render();
    scope.select(null);
    h.fixture.detectChanges();
    await settle();
    const all = listRequest();
    expect(all.request.params.has('estateId')).toBe(false);
    expect(all.request.params.has('propertyId')).toBe(false);
    all.flush(issueList([issueItem({ id: 'i1' }), issueItem({ id: 'i3', estateId: 'e2', estateName: 'Cuba 18' })]));
    await render();
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: Todas mis comunidades');
    // En «Todas» cada fila dice de qué comunidad es.
    expect(Array.from(h.el.querySelectorAll('[data-community-name]')).map((e) => text(e))).toEqual(['Edificio Sol', 'Cuba 18']);
  });

  it('?estateId= chooses that community once the properties are known and drops the param', async () => {
    // El parámetro se lee al crear la página, antes de que mount() espíe el router.
    const early = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    const scope = await mount(fakeScope([P1, P2], { selectedId: 'p1' }), { estateId: 'e2' });
    await render();
    expect(scope.select).toHaveBeenCalledWith('p2');
    expect(early).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { estateId: null }, queryParamsHandling: 'merge', replaceUrl: true }));
    early.mockRestore();
    await settle();
    for (const r of h.http.match((req) => req.url === `${API}/me/issues`)) r.flush(issueList());
  });

  it('shows the three indicators from the API and clicking one filters the list', async () => {
    await mount();
    await flushList();
    const tile = (id: string) => ['.kpi__label', '.kpi__value', '.kpi__sub'].map((c) => text(h.el.querySelector(`[data-kpi="${id}"] ${c}`)));
    expect(tile('open')).toEqual(['Abiertas', '3', 'Requieren atención']);
    expect(tile('inProgress')).toEqual(['En curso', '2', '']);
    expect(tile('resolved')).toEqual(['Resueltas', '5', 'Últimos 6 meses']);
    expect(h.el.querySelector('[data-kpi="inProgress"] .kpi__icon--blue')).not.toBeNull();

    h.el.querySelector<HTMLButtonElement>('[data-kpi="open"]')!.click();
    h.fixture.detectChanges();
    await settle();
    expect(listRequest().request.params.get('status')).toBe('Abierta,PendienteInformacion');
  });

  it('the search is debounced and sent to the server', async () => {
    await mount();
    await flushList();
    const input = h.el.querySelector<HTMLInputElement>('[data-search]')!;
    expect(input.placeholder).toBe('Buscar por asunto o descripción…');
    input.value = 'ascensor';
    input.dispatchEvent(new Event('input'));
    h.http.expectNone((r) => r.url === `${API}/me/issues`);
    await wait(350);
    expect(listRequest().request.params.get('q')).toBe('ascensor');
  });

  it('one «Filtrar» popover filters by status, counts the active filters and clears them', async () => {
    await mount();
    await flushList();
    h.el.querySelector<HTMLButtonElement>('[data-action="filters"]')!.click();
    h.fixture.detectChanges();
    const popover = h.el.querySelector('[data-filter-popover]')!;
    const options = (name: string) => Array.from(popover.querySelectorAll<HTMLOptionElement>(`[data-filter="${name}"] option`)).map((o) => o.textContent?.trim());
    expect(popover.querySelector('[data-filter="tipo"]')).toBeNull();
    expect(options('estado')).toEqual(['Todos', 'Abiertas', 'En curso', 'Pendiente de información', 'Resueltas', 'Retiradas', 'En trámite']);
    expect(popover.querySelector('[data-filter="ambito"]')).toBeNull();

    const choose = async (name: string, value: string) => {
      const select = popover.querySelector<HTMLSelectElement>(`[data-filter="${name}"]`)!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      await settle();
    };
    await choose('estado', 'enCurso');
    const req = listRequest();
    expect(req.request.params.has('category')).toBe(false);
    expect(req.request.params.get('status')).toBe('EnReparacion,PendienteProveedor');
    expect(req.request.params.has('scope')).toBe(false);
    req.flush(issueList());
    await render();
    expect(text(h.el.querySelector('[data-filter-count]'))).toBe('1');

    h.el.querySelector<HTMLButtonElement>('[data-action="clear-filters"]')!.click();
    h.fixture.detectChanges();
    await settle();
    const cleared = listRequest();
    expect(cleared.request.params.has('status')).toBe(false);
    cleared.flush(issueList());
    await render();
    expect(h.el.querySelector('[data-filter-count]')).toBeNull();
  });

  it('keeps the filters popover open when choosing in the Domora dropdown list (it lives in the body), and closes it on a real outside click', async () => {
    await mount();
    await flushList();
    h.el.querySelector<HTMLButtonElement>('[data-action="filters"]')!.click();
    h.fixture.detectChanges();
    const panel = document.createElement('app-select-panel');
    const option = document.createElement('button');
    panel.appendChild(option);
    document.body.appendChild(panel);
    try {
      option.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[data-filter-popover]')).not.toBeNull();
    } finally {
      panel.remove();
    }
    document.body.click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-filter-popover]')).toBeNull();
  });

  it('renders the rows with subject, type, location, date and status, and marks the issues of other neighbours and the ones waiting for an answer', async () => {
    await mount();
    await flushList(issueList([
      issueItem({ id: 'i1', status: 'EnReparacion' }),
      issueItem({ id: 'i2', title: 'Ruido en el portal', description: 'Golpes por la noche', type: 'Ruido', location: 'Portal 1', status: 'PendienteInformacion', mine: false, date: '2026-09-02T00:00:00.000Z' }),
    ]));
    const row = h.el.querySelector('[data-issue="i1"]')!;
    expect(text(row.querySelector('.issue-row__title'))).toBe('Gotera en el garaje');
    expect(text(row.querySelector('.issue-row__excerpt'))).toBe('Cae agua del techo junto a la plaza 12 cuando llueve.');
    expect(text(row.querySelector('[data-col="tipo"]'))).toBe('Fuga');
    expect(text(row.querySelector('[data-col="ubicacion"]'))).toBe('Garaje');
    expect(text(row.querySelector('[data-col="fecha"]'))).toBe('20 oct 2026');
    expect(text(row.querySelector('[data-col="estado"]'))).toBe('En curso');
    expect(row.querySelector('[data-col="estado"] .pill--info')).not.toBeNull();
    expect(row.querySelector('[data-neighbour-marker]')).toBeNull();
    expect(row.querySelector('[data-awaiting-answer]')).toBeNull();
    const other = h.el.querySelector('[data-issue="i2"]')!;
    expect(text(other.querySelector('[data-neighbour-marker]'))).toBe('De un vecino');
    expect(other.querySelector('[data-col="estado"] .pill--warning')).not.toBeNull();
    // Quien tiene que contestar lo ve en la fila.
    const mineAsked = issueItem({ id: 'i3', status: 'PendienteInformacion', awaitingMyAnswer: true });
    h.component.list.set(issueList([mineAsked]));
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-issue="i3"] [data-awaiting-answer]'))).toBe('Te piden información');
    expect(h.el.querySelector('[data-issue="i3"] [data-neighbour-marker]')).toBeNull();
  });

  it('sorts by date, newest first by default, and toggles', async () => {
    await mount();
    await flushList(issueList([
      issueItem({ id: 'old', date: '2026-01-02T00:00:00.000Z' }),
      issueItem({ id: 'new', date: '2026-10-02T00:00:00.000Z' }),
    ]));
    const order = () => Array.from(h.el.querySelectorAll('[data-issue]')).map((r) => r.getAttribute('data-issue'));
    expect(order()).toEqual(['new', 'old']);
    const sort = h.el.querySelector<HTMLButtonElement>('[data-sort="date"]')!;
    expect(sort.closest('th')!.getAttribute('aria-sort')).toBe('descending');
    sort.click();
    h.fixture.detectChanges();
    expect(order()).toEqual(['old', 'new']);
    expect(sort.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
  });

  it('shows an empty state and an error state', async () => {
    await mount();
    await flushList(issueList([]));
    expect(text(h.el.querySelector('[data-list-empty]'))).toContain('No hay incidencias');
    h.component.reload();
    await settle();
    listRequest().flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
    await render();
    expect(text(h.el.querySelector('[data-list-error]'))).toBe('No se pudieron cargar las incidencias. Inténtalo de nuevo.');
  });

  it('clicking a row (or Enter on it) opens its detail, highlights it and keeps ?issue in the URL; closing removes it', async () => {
    await mount();
    await flushList();
    const row = h.el.querySelector<HTMLElement>('[data-issue="i1"]')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/me/issues/i1`).flush(issueDetail());
    await render();
    expect(h.el.querySelector('app-issue-detail [data-detail-title]')).not.toBeNull();
    expect(h.el.querySelector('[data-issue="i1"]')!.classList.contains('issue-row--selected')).toBe(true);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { issue: 'i1' }, queryParamsHandling: 'merge' }));

    h.el.querySelector<HTMLButtonElement>('app-issue-detail [data-action="close"]')!.click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-issue-detail')).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { issue: null }, queryParamsHandling: 'merge' }));
  });

  it('a deep link ?issue=<id> opens that detail', async () => {
    await mount(undefined, { issue: 'i7' });
    await flushList();
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/me/issues/i7`).flush(issueDetail({ id: 'i7', title: 'Puerta del garaje' }));
    await render();
    expect(text(h.el.querySelector('app-issue-detail [data-detail-title]'))).toBe('Puerta del garaje');
  });

  it('an action in the detail refreshes the list and the indicators', async () => {
    await mount(undefined, { issue: 'i1' });
    await flushList();
    await settle();
    h.http.expectOne(`${API}/me/issues/i1`).flush(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false, canReopen: true }));
    await render();
    h.el.querySelector<HTMLButtonElement>('[data-action="reopen"]')!.click();
    h.http.expectOne(`${API}/me/issues/i1/reopen`).flush(issueDetail());
    await render();
    listRequest().flush(issueList(undefined, { open: 4, inProgress: 2, resolved: 4 }));
    await render();
    expect(text(h.el.querySelector('[data-kpi="open"] .kpi__value'))).toBe('4');
  });

  it('«Nueva incidencia» opens the creation modal for the selected community; creating opens the new issue', async () => {
    await mount();
    await flushList();
    h.el.querySelector<HTMLButtonElement>('[data-action="new-issue"]')!.click();
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/me/issues/locations?estateId=e1`).flush([]);
    expect(h.el.querySelector('app-new-issue-modal [role="dialog"]')).not.toBeNull();
    // La comunidad se ve, pero fija: la elegida en la cabecera.
    expect(h.el.querySelector<HTMLSelectElement>('app-new-issue-modal [data-field="estate"]')!.disabled).toBe(true);

    h.component.onCreated({ id: 'new1', failedUploads: ['parte.pdf'] });
    h.fixture.detectChanges();
    await settle();
    expect(h.el.querySelector('app-new-issue-modal')).toBeNull();
    listRequest().flush(issueList());
    h.http.expectOne(`${API}/me/issues/new1`).flush(issueDetail({ id: 'new1' }));
    await render();
    expect(text(h.el.querySelector('[data-page-notice]'))).toBe('Se ha creado, pero no se pudo subir «parte.pdf». Puedes añadirlo desde el detalle.');
  });

  it('a deep link ?new=1 opens the creation modal on load and removes the param from the URL', async () => {
    // The param is read while the page is created, before mount() spies on the router instance.
    const early = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await mount(undefined, { new: '1' });
    await flushList();
    h.http.expectOne(`${API}/me/issues/locations?estateId=e1`).flush([]);
    await render();
    expect(h.el.querySelector('app-new-issue-modal [role="dialog"]')).not.toBeNull();
    expect(early).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true }));

    // The URL without the param does not close the modal it just opened.
    params.next(convertToParamMap({}));
    await render();
    expect(h.el.querySelector('app-new-issue-modal [role="dialog"]')).not.toBeNull();
    early.mockRestore();
  });

  it('with «Todas» the creation modal asks for the community, never for a home', async () => {
    await mount(fakeScope([P1, P2], { selectedId: null }));
    await flushList();
    h.el.querySelector<HTMLButtonElement>('[data-action="new-issue"]')!.click();
    h.fixture.detectChanges();
    await settle();
    const select = h.el.querySelector('app-new-issue-modal [data-field="estate"]')!;
    expect(select).not.toBeNull();
    expect(Array.from(select.querySelectorAll('option')).map((o) => text(o))).toEqual(['Selecciona una comunidad', 'Colón 24', 'Cuba 18']);
    expect(h.el.querySelector('app-new-issue-modal [data-field="property"]')).toBeNull();
  });

  it('without properties invites to add one', async () => {
    await mount(fakeScope([]));
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-empty]'))).toContain('Todavía no tienes ninguna propiedad vinculada');
    h.el.querySelector<HTMLButtonElement>('[data-empty] button')!.click();
    expect(TestBed.inject(StateService).showAddPropertyModal()).toBe(true);
  });
});
