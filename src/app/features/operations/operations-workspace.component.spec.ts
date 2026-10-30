import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import {
  API,
  setupComponent,
  makeUser,
  settle,
} from '../../core/testing/component-harness';
import { OperationsWorkspaceComponent } from './operations-workspace.component';
import { CreateJuntaModalComponent } from '../estate-detail/juntas-tab/create-junta-modal/create-junta-modal.component';

const estate = {
  id: 'e1',
  name: 'Edificio Sol',
  administratorId: 'admin1',
  address: 'Mayor',
  location: 'Madrid',
};
const meeting = {
  id: 'm1',
  estateId: 'e1',
  title: 'Junta de octubre',
  type: 'ordinaria',
  status: 'convocada',
  scheduledAt1: '2026-10-20T18:00:00Z',
  estate,
  agenda: [{ id: 'a1', title: 'Cuentas de la comunidad' }],
};
const issue = {
  id: 'i1',
  ref: '#INC-1',
  title: 'Fuga de agua',
  type: 'Fuga',
  status: 'Abierta',
  priority: 'Urgente',
  date: '2026-10-10',
  description: 'Revisar tubería',
  estate,
  _count: { photos: 0 },
};
const page = (items: unknown[] = [meeting]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 12,
  summary: { convocada: 1, open: 1 },
});

describe('OperationsWorkspaceComponent', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  function setup(
    kind = 'meetings',
    opts: { estates?: unknown[]; query?: Record<string, string> } = {},
  ) {
    const params = new BehaviorSubject(convertToParamMap(opts.query ?? {}));
    const h = setupComponent(OperationsWorkspaceComponent, {
      user: makeUser(),
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { operationsKind: kind } },
            queryParamMap: params,
          },
        },
      ],
    });
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates`).flush(opts.estates ?? [estate]);
    return { ...h, params };
  }

  /** El detalle de la junta seleccionada se monta solo: responde a sus 6 peticiones. */
  async function openDetail(
    h: ReturnType<typeof setup>,
    row: typeof meeting = meeting,
    overrides: Record<string, unknown> = {},
  ) {
    h.fixture.detectChanges();
    await flushDetail(h, row, overrides);
  }
  async function flushDetail(
    h: ReturnType<typeof setup>,
    row: typeof meeting = meeting,
    overrides: Record<string, unknown> = {},
  ) {
    const body: Record<string, unknown> = {
      [`/meetings/${row.id}`]: { ...row, scheduledAt2: '2026-10-20T18:30:00Z', ...overrides },
      [`/meetings/${row.id}/quorum`]: {
        convocatoria: 'primera',
        quorumRequired: true,
        quorumMet: true,
        owners: { present: 18, total: 24, percent: 75 },
        quota: { present: 72.4, total: 100, percent: 72.4 },
        missingParticipationQuotaCount: 0,
        attendingProperties: [],
      },
      [`/meetings/${row.id}/attendance`]: [],
      [`/estates/${row.estateId}/properties`]: [
        { id: 'p1', ref: '1A', participationQuota: 4.2 },
      ],
      [`/meetings/${row.id}/delegations`]: [],
      [`/meetings/${row.id}/vote-sessions`]: [],
    };
    for (const request of h.http.match((req) => req.url.startsWith(API)))
      request.flush(body[request.request.url.slice(API.length)] ?? []);
    await settle();
    h.fixture.detectChanges();
  }
  async function pickMenuItem(h: ReturnType<typeof setup>, label: string) {
    (h.el.querySelector('.actions-menu__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const item = Array.from(
      h.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((b) => b.textContent?.includes(label));
    expect(item).toBeDefined();
    item!.click();
  }
  it('shows the meeting list with the selected meeting detail alongside', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('h1')?.textContent).toBe('Juntas');
    expect(h.el.querySelector('.metric strong')?.textContent).toBe('1');
    await openDetail(h);
    expect(h.el.querySelector('.row-community')?.textContent).toContain(
      'Edificio Sol',
    );
    expect(h.el.querySelector('.operations-table')).not.toBeNull();
    expect(
      h.el.querySelector('.workspace-preview app-meeting-workspace h1')
        ?.textContent,
    ).toContain('Junta de octubre');
    h.http.verify();
  });
  it('offers the signed meetings as their own filter, metric and status colour', async () => {
    const h = setup();
    const signed = { ...meeting, status: 'firmada', actaSignedAt: '2026-10-21T10:00:00Z' };
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush({ ...page([signed]), summary: { convocada: 1, celebrada: 2, firmada: 3, cancelada: 0 } });
    await settle();
    h.fixture.detectChanges();
    const metrics = Array.from(h.el.querySelectorAll('.metric')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(metrics).toEqual(['Convocadas1', 'Celebradas2', 'Firmadas3', 'Canceladas0']);
    expect(Array.from(h.el.querySelectorAll('.filter-tabs button')).map((b) => b.textContent?.trim())).toEqual(['Todas', 'Convocadas', 'Celebradas', 'Firmadas', 'Canceladas']);
    expect(h.el.querySelector('.status-tag.tone-green')?.textContent).toContain('Firmada');
    await openDetail(h, signed as typeof meeting);
  });

  it('ignores stale responses when the community changes', async () => {
    const h = setup();
    const old = h.http.expectOne(
      (req) => req.url === `${API}/operations/meetings`,
    );
    h.params.next(convertToParamMap({ estateId: 'e2' }));
    const current = h.http.expectOne(
      (req) =>
        req.url === `${API}/operations/meetings` &&
        req.params.get('estateId') === 'e2',
    );
    // La consulta anterior se cancela al pedir la nueva: su respuesta nunca llega a competir con la actual.
    expect(old.cancelled).toBe(true);
    current.flush(page([{ ...meeting, id: 'm2', title: 'Comunidad nueva' }]));
    await settle();
    h.fixture.detectChanges();
    await flushDetail(h, { ...meeting, id: 'm2', title: 'Comunidad nueva' });
    expect(h.el.textContent).toContain('Comunidad nueva');
    expect(h.el.textContent).not.toContain('Junta de octubre');
    h.http.verify();
  });
  it('renders API errors and retries without showing a false empty result', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudieron cargar',
    );
    expect(h.el.querySelector('.preview-empty')).toBeNull();
    (h.el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page([]));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
    expect(h.el.textContent).toContain('Todavía no hay juntas');
    h.http.verify();
  });
  it('retains a typed search and resets pagination when another filter changes', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    h.component.onSearch('ascensor');
    h.component.setQuery({ estateId: 'e1' });
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: {
          search: 'ascensor',
          estateId: 'e1',
          page: 1,
          entity: null,
        },
      }),
    );
    h.http.verify();
  });
  describe('issues list', () => {
    it('reads the work filters from the URL and sends them to the server', async () => {
      const h = setup('issues', {
        query: { filter: 'waiting', ball: 'insurer', status: 'Abierta', situation: 'waiting_third_party', created: '7d' },
      });
      const request = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      expect(request.request.params.get('filter')).toBe('waiting');
      expect(request.request.params.get('ball')).toBe('insurer');
      expect(request.request.params.get('status')).toBe('Abierta');
      expect(request.request.params.get('situation')).toBe('waiting_third_party');
      expect(request.request.params.get('created')).toBe('7d');
      request.flush({ ...page([issue]), summary: { all: 1, waiting: 1 } });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.card--active')?.getAttribute('data-filter')).toBe('waiting');
      h.http.verify();
    });
    it('filters by the installation of the link and shows its name', async () => {
      const h = setup('issues', { query: { assetId: 'a1' } });
      const request = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      expect(request.request.params.get('assetId')).toBe('a1');
      request.flush({ ...page([issue]), asset: { id: 'a1', name: 'Cubierta' } });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[data-asset-filter]')?.textContent).toContain('Cubierta');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.el.querySelector<HTMLButtonElement>('.asset-filter__clear')!.click();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: expect.objectContaining({ assetId: null }) }),
      );
      h.http.verify();
    });
    it('sends the column sort of the URL to the server', async () => {
      const h = setup('issues', { query: { sort: 'title_desc' } });
      const request = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      expect(request.request.params.get('sort')).toBe('title_desc');
      request.flush(page([issue]));
      h.http.verify();
    });
    it('reads a link with an old filter as «Todas» instead of failing', async () => {
      const h = setup('issues', { query: { filter: 'active' } });
      const request = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      expect(request.request.params.get('filter')).toBe('all');
      request.flush(page([issue]));
      h.http.verify();
    });
    it('clears every issue filter, the new ones included', async () => {
      const h = setup('issues', { query: { ball: 'insurer', created: '7d' } });
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([issue]));
      await settle();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.component.clearFilters();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ ball: null, created: null, status: null, situation: null, filter: null }),
        }),
      );
      h.http.verify();
    });
    it('a filter change keeps the rows, the totals and the cards on screen until the new answer arrives', async () => {
      const h = setup('issues');
      h.http
        .expectOne((req) => req.url === `${API}/operations/issues`)
        .flush({ ...page([issue]), summary: { all: 7, attention: 3 } });
      await settle();
      h.fixture.detectChanges();
      const rows = () => Array.from(h.el.querySelectorAll('app-issues-list tbody tr'));
      const cardValues = () => Array.from(h.el.querySelectorAll('app-issues-list .card strong')).map((e) => e.textContent?.trim());
      const firstRow = rows()[0];
      expect(rows().length).toBe(1);
      expect(h.component.initialLoading()).toBe(false);

      h.params.next(convertToParamMap({ filter: 'attention' }));
      h.fixture.detectChanges();
      // Consulta en curso: es un refresco, no una carga inicial. Nada se vacía ni se sustituye por «Cargando…».
      expect(h.component.refreshing()).toBe(true);
      expect(h.component.initialLoading()).toBe(false);
      expect(rows()).toEqual([firstRow]);
      expect(h.el.textContent).not.toContain('Cargando incidencias');
      expect(cardValues()).not.toContain('—');
      expect(cardValues()).toContain('7');
      expect(h.el.querySelector('app-issues-list .list')?.classList.contains('list--refreshing')).toBe(true);

      h.http
        .expectOne((req) => req.url === `${API}/operations/issues` && req.params.get('filter') === 'attention')
        .flush({ ...page([issue]), summary: { all: 7, attention: 3 } });
      await settle();
      h.fixture.detectChanges();
      expect(h.component.refreshing()).toBe(false);
      // La misma incidencia sigue siendo la misma fila: no se destruye ni se vuelve a crear.
      expect(rows()[0]).toBe(firstRow);
      expect(h.el.querySelector('app-issues-list .list')?.classList.contains('list--refreshing')).toBe(false);
      h.http.verify();
    });
    it('only the very first load shows «Cargando…» and the dashes in the cards', async () => {
      const h = setup('issues');
      h.fixture.detectChanges();
      expect(h.component.initialLoading()).toBe(true);
      expect(h.el.textContent).toContain('Cargando incidencias');
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([issue]));
      await settle();
      h.fixture.detectChanges();
      expect(h.component.initialLoading()).toBe(false);
      expect(h.el.textContent).not.toContain('Cargando incidencias');
      h.http.verify();
    });
    it('quick consecutive filters send one request each and cancel the previous one', async () => {
      const h = setup('issues');
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([issue]));
      await settle();
      h.params.next(convertToParamMap({ filter: 'attention' }));
      const first = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      h.params.next(convertToParamMap({ filter: 'resolved' }));
      const second = h.http.expectOne((req) => req.url === `${API}/operations/issues`);
      expect(first.cancelled).toBe(true);
      expect(second.request.params.get('filter')).toBe('resolved');
      second.flush(page([issue]));
      await settle();
      h.fixture.detectChanges();
      expect(h.component.refreshing()).toBe(false);
      expect(h.el.querySelector('.card--active')?.getAttribute('data-filter')).toBe('resolved');
      h.http.verify();
    });
    it('opens the issue page of the clicked issue', async () => {
      const h = setup('issues');
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([issue]));
      await settle();
      h.fixture.detectChanges();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.el.querySelector<HTMLTableRowElement>('app-issues-list tbody tr')!.click();
      expect(navigate).toHaveBeenCalledWith(['/b/incidencias', 'i1']);
      h.http.verify();
    });
  });
  it('updates issue status through the existing domain API and refreshes the list', async () => {
    const h = setup('issues');
    h.http
      .expectOne((req) => req.url === `${API}/operations/issues`)
      .flush(page([issue]));
    await settle();
    h.fixture.detectChanges();
    const update = h.component.updateIssueStatus(
      h.component.data().items[0],
      'En reparación',
    );
    const request = h.http.expectOne(`${API}/issues/i1/status`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ status: 'EnReparacion' });
    request.flush({ ...issue, status: 'EnReparacion' });
    await settle();
    h.http
      .expectOne((req) => req.url === `${API}/operations/issues`)
      .flush(page([{ ...issue, status: 'EnReparacion' }]));
    await update;
    h.fixture.detectChanges();
    expect(h.el.querySelector('.workspace-notice')).toBeNull();
    expect(h.component.data().items[0].statusLabel).toBe('En reparación');
    h.http.verify();
  });
  it('cerrar una incidencia con un siniestro abierto explica por qué, sin el código técnico', async () => {
    const h = setup('issues');
    h.http
      .expectOne((req) => req.url === `${API}/operations/issues`)
      .flush(page([issue]));
    await settle();
    h.fixture.detectChanges();
    const update = h.component.updateIssueStatus(h.component.data().items[0], 'Cerrada');
    h.http.expectOne(`${API}/issues/i1/status`).flush(
      { code: 'ISSUE_HAS_OPEN_INSURANCE_CLAIM', message: 'técnico' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    // Se vuelve a leer el estado real; el aviso no sustituye a la lista (no es un error de carga).
    h.http
      .expectOne((req) => req.url === `${API}/operations/issues`)
      .flush(page([issue]));
    await update;
    h.fixture.detectChanges();
    const notice = h.el.querySelector('.workspace-error')?.textContent ?? '';
    expect(notice).toContain('No puedes cerrar esta incidencia porque todavía tiene un siniestro abierto.');
    expect(notice).toContain('Puedes dejarla como Resuelta');
    expect(notice).not.toContain('ISSUE_HAS_OPEN_INSURANCE_CLAIM');
    expect(notice).not.toContain('Reintentar');
    expect(h.component.error()).toBe('');
    h.http.verify();
  });
  it('no deja marcar como celebrada una junta cuya primera convocatoria aún no ha llegado, y lo explica', async () => {
    const h = setup();
    const future = { ...meeting, scheduledAt1: '2099-01-10T18:00:00Z' };
    h.http.expectOne((req) => req.url === `${API}/operations/meetings`).flush(page([future]));
    await settle();
    h.fixture.detectChanges();
    await openDetail(h, future);
    (h.el.querySelector('.actions-menu__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const item = Array.from(h.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent?.includes('Marcar como celebrada'))!;
    expect(item.disabled).toBe(true);
    expect(item.getAttribute('title')).toContain('Disponible desde la 1ª convocatoria');
  });
  it('preserves confirmed lifecycle actions and refreshes the meeting summary', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.fixture.detectChanges();
    await openDetail(h);
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
    await pickMenuItem(h, 'Marcar como celebrada');
    const patch = h.http.expectOne(`${API}/meetings/m1/status`);
    expect(patch.request.body).toEqual({ status: 'celebrada' });
    patch.flush({ ...meeting, status: 'celebrada' });
    await settle();
    await flushDetail(h, meeting, { status: 'celebrada' });
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page([{ ...meeting, status: 'celebrada' }]));
    await settle();
    h.fixture.detectChanges();
    expect(h.component.selected()?.status).toBe('celebrada');
    expect(h.el.querySelector('.workspace-notice')).toBeNull();
    expect(h.el.querySelector('app-status-pill')?.textContent).toContain(
      'Celebrada',
    );
    h.http.verify();
  });
  it('keeps the create-junta modal mounted so its success step is shown', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.fixture.detectChanges();
    const open = Array.from(h.el.querySelectorAll('app-btn button')).find((b) =>
      b.textContent?.includes('Nueva junta'),
    ) as HTMLButtonElement;
    open.click();
    h.fixture.detectChanges();
    h.http
      .expectOne(`${API}/estates/e1/properties/owner-emails`)
      .flush([]);
    await settle();
    h.fixture.detectChanges();
    const modal = h.fixture.debugElement.query(
      By.directive(CreateJuntaModalComponent),
    ).componentInstance as CreateJuntaModalComponent;
    modal.draft.title.set('Junta nueva');
    modal.draft.scheduledAt1.set('2026-12-10T19:00');
    modal.draft.scheduledAt2.set('2026-12-10T19:30');
    modal.draft.agenda.set([
      { id: 'a1', title: 'Cuentas', description: '', hasVote: false },
    ]);
    void modal.submit();
    h.http
      .expectOne(`${API}/estates/e1/meetings`)
      .flush({ ...meeting, id: 'm2', title: 'Junta nueva' });
    await settle();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page([{ ...meeting, id: 'm2', title: 'Junta nueva' }]));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('¡Junta creada correctamente!');
    expect(h.component.selected()?.id).toBe('m2');
    await flushDetail(h, { ...meeting, id: 'm2', title: 'Junta nueva' });
    h.http.verify();
  });
  describe('community picker when creating', () => {
    const other = { ...estate, id: 'e2', name: 'Edificio Luna' };
    async function openNew(
      query: Record<string, string> = {},
      kind: 'meetings' | 'issues' = 'meetings',
    ) {
      const h = setup(kind, { estates: [estate, other], query });
      h.http
        .expectOne((req) => req.url === `${API}/operations/${kind}`)
        .flush(page());
      await settle();
      h.fixture.detectChanges();
      const open = Array.from(h.el.querySelectorAll('app-btn button')).find(
        (b) => b.textContent?.includes(kind === 'meetings' ? 'Nueva junta' : 'Nueva incidencia'),
      ) as HTMLButtonElement;
      open.click();
      h.fixture.detectChanges();
      return h;
    }
    it('lets the junta wizard choose the community in its first step when none is selected', async () => {
      const h = await openNew();
      expect(h.el.querySelector('.creation-dialog')).toBeNull();
      expect(h.component.creationEstateId()).toBe('');
      const select = h.el.querySelector('select[aria-label="Comunidad de la junta"]') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
        'Selecciona una comunidad',
        estate.name,
        'Edificio Luna',
      ]);
      h.http.match((req) => req.url.includes('/properties/owner-emails'));
    });
    it('shows the picker with the community of the switcher already chosen', async () => {
      const h = await openNew({ estateId: 'e1' });
      const select = h.el.querySelector('select[aria-label="Comunidad de la junta"]') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(h.component.creationEstateId()).toBe('e1');
      h.http.match((req) => req.url.includes('/properties/owner-emails'));
    });
    it('opens the issue dialog without a community and lets it choose one inside', async () => {
      const h = await openNew({}, 'issues');
      // Ya no hay un paso previo para elegir la comunidad: se elige en el propio formulario.
      expect(h.el.querySelector('.creation-dialog')).toBeNull();
      expect(h.component.newIssueEstateId()).toBe('');
      const dialog = h.el.querySelector('app-new-issue-dialog')!;
      const select = dialog.querySelector('select[data-field="estate"]') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent?.trim().split(' · ')[0])).toEqual([
        'Selecciona una comunidad',
        estate.name,
        'Edificio Luna',
      ]);
    });
    it('creates an issue in a dialog of this page and opens its page afterwards', async () => {
      const h = await openNew({ estateId: 'e1' }, 'issues');
      // Con una comunidad elegida no se pregunta: el diálogo de la incidencia se abre directamente.
      expect(h.el.querySelector('.creation-dialog')).toBeNull();
      expect(h.component.newIssueEstateId()).toBe('e1');
      expect(h.el.querySelector('app-new-issue-dialog')).not.toBeNull();
      h.http.expectOne(`${API}/estates/e1/assets`).flush([]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      h.component.issueCreated({ ...issue, id: 'new-1' } as never);
      h.fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith(['/b/incidencias', 'new-1']);
      expect(h.el.querySelector('app-new-issue-dialog')).toBeNull();
    });
  });
  it('resolves a linked meeting outside the current page instead of selecting another one', async () => {
    const h = setup();
    const initial = h.http.expectOne(
      (req) => req.url === `${API}/operations/meetings`,
    );
    h.params.next(convertToParamMap({ entity: 'old' }));
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    expect(initial.cancelled).toBe(true);
    await settle();
    h.http
      .expectOne(`${API}/meetings/old`)
      .flush({ ...meeting, id: 'old', title: 'Junta antigua' });
    await settle();
    h.http.expectOne(`${API}/estates/e1`).flush(estate);
    await settle();
    h.fixture.detectChanges();
    expect(h.component.selected()?.id).toBe('old');
    await flushDetail(h, { ...meeting, id: 'old', title: 'Junta antigua' });
    expect(h.el.querySelector('app-meeting-workspace h1')?.textContent).toContain(
      'Junta antigua',
    );
    h.http.verify();
  });
  it('does not replace a missing linked meeting with the first result', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.params.next(convertToParamMap({ entity: 'missing' }));
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.http
      .expectOne(`${API}/meetings/missing`)
      .flush({}, { status: 404, statusText: 'Not found' });
    await settle();
    h.fixture.detectChanges();
    expect(h.component.selected()).toBeNull();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo abrir la junta',
    );
    h.http.verify();
  });
  it('does not cancel a meeting when confirmation is declined', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.fixture.detectChanges();
    await openDetail(h);
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
    await pickMenuItem(h, 'Cancelar junta');
    h.http.expectNone(`${API}/meetings/m1/status`);
    h.http.verify();
  });

  it('opens the edit wizard prefilled from the detail menu and refreshes after saving', async () => {
    const h = setup();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page());
    await settle();
    h.fixture.detectChanges();
    await openDetail(h);
    await pickMenuItem(h, 'Editar junta');
    h.fixture.detectChanges();
    const modal = h.fixture.debugElement.query(
      By.directive(CreateJuntaModalComponent),
    ).componentInstance as CreateJuntaModalComponent;
    expect(modal.editing).toBe(true);
    expect(modal.draft.title()).toBe('Junta de octubre');
    modal.draft.title.set('Junta editada');
    modal.next();
    const saving = modal.submit();
    const patch = h.http.expectOne(`${API}/meetings/m1`);
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ ...meeting, title: 'Junta editada' });
    await saving;
    await settle();
    h.http
      .expectOne((req) => req.url === `${API}/operations/meetings`)
      .flush(page([{ ...meeting, title: 'Junta editada' }]));
    await settle();
    h.fixture.detectChanges();
    // El detalle recarga los datos porque el título cambió.
    await flushDetail(h, meeting, { title: 'Junta editada' });
    expect(h.el.querySelector('app-create-junta-modal .wizard')).toBeNull();
    expect(h.el.querySelector('.workspace-notice')).toBeNull();
    expect(h.el.querySelector('.workspace-preview h1')?.textContent).toContain(
      'Junta editada',
    );
    h.http.verify();
  });

  describe('acta download from the summary', () => {
    const signed = { status: 'firmada', actaSignedAt: '2026-10-21T10:00:00Z' };
    async function open(overrides: Record<string, unknown>) {
      const h = setup();
      h.http
        .expectOne((req) => req.url === `${API}/operations/meetings`)
        .flush(page([{ ...meeting, status: 'celebrada' }]));
      await settle();
      await openDetail(h, meeting, overrides);
      const button = Array.from(
        h.el.querySelectorAll('app-meeting-summary-tab app-btn button'),
      ).find((b) => b.textContent?.includes('Descargar acta'));
      h.http.verify();
      return button;
    }
    it('is offered once the acta was sent to the owners', async () => {
      expect(await open({ ...signed, actaDistributedAt: '2026-10-22T10:00:00Z' })).toBeDefined();
    });
    it('is not offered while the acta was not sent yet', async () => {
      expect(await open(signed)).toBeUndefined();
    });
  });

  describe('issue zone and the states only the issue flow sets', () => {
    const request = { ...issue, id: 'i2', ref: '#INC-2', title: 'Cerradura del portal', type: 'Averia', location: 'Portal 1', status: 'PendienteInformacion' };
    const common = { ...issue, location: 'Garaje' };

    it('keeps each row to the title and one line of description, without the zone', async () => {
      const h = setup('issues');
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([common, request]));
      await settle();
      h.fixture.detectChanges();
      const rows = Array.from(h.el.querySelectorAll('app-issues-list tbody tr'));
      expect(rows).toHaveLength(2);
      expect(rows.some((r) => r.querySelector('[data-location]'))).toBe(false);
      h.http.verify();
    });

    it('has no category filter: neither the filter row nor the API know one', async () => {
      const h = setup('issues', { query: { category: 'Solicitud' } });
      const req = h.http.expectOne((r) => r.url === `${API}/operations/issues`);
      expect(req.request.params.has('category')).toBe(false);
      req.flush(page([request]));
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-issues-list select[aria-label="Categoría"]')).toBeNull();
      expect(h.el.querySelector('app-issues-list [data-category]')).toBeNull();
      h.http.verify();
    });

    it('labels «Pendiente de información», filters by it, and does not offer it for a quick change', async () => {
      const h = setup('issues');
      h.http.expectOne((req) => req.url === `${API}/operations/issues`).flush(page([request]));
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-issues-list tbody tr td:nth-child(4) .situation')?.textContent?.trim()).toBe('Pendiente de información');
      const filter = h.el.querySelector('app-issues-list select[aria-label="Estado"]') as HTMLSelectElement;
      expect(Array.from(filter.querySelectorAll('option')).map((o) => o.textContent?.trim()))
        .toEqual(['Estado', 'Abierta', 'En reparación', 'Pendiente proveedor', 'Pendiente de información', 'Resuelta', 'Cerrada']);
      (h.el.querySelector('.row-menu__trigger') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      const manual = Array.from(h.el.querySelectorAll('.row-menu [role="menuitemradio"]')).map((b) => b.textContent?.trim());
      expect(manual).toEqual(['Abierta', 'En reparación', 'Pendiente proveedor', 'Resuelta', 'Cerrada']);
      h.http.verify();
    });
  });
});
