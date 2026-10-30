import type { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { API, makeUser, setupComponent, settle } from '../../../core/testing/component-harness';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { IssueDetailPageComponent } from './issue-detail-page.component';

const issue = {
  id: 'i1',
  ref: 'INC-2024-0087',
  estateId: 'e1',
  type: 'Averia',
  title: 'Humedad en portal principal',
  description: 'Filtraciones en la pared del portal.',
  status: 'PendienteProveedor',
  priority: 'Normal',
  source: 'Propietario',
  date: '2026-10-13',
  owner: 'María García López',
  photos: [],
  timeline: [],
  reports: [{ id: 'r1', channel: 'app', reporterUserId: 'u9', reporterName: 'María García López', receivedAt: '2026-10-13T09:12:00Z' }],
};
const estate = { id: 'e1', name: 'Comunidad Sol y Mar', address: 'Paseo Marítimo', streetNumber: '58', postalCode: '29610', location: 'Málaga' };
const holder = (party: string, label: string, source = 'wait') => ({ party, label, source, since: null, dueAt: null, refId: `${party}-1` });
const situation = (over: Record<string, unknown> = {}) => ({
  issueId: 'i1',
  situation: 'waiting_third_party',
  label: 'Esperando tercero',
  nextStep: { kind: 'waiting', code: 'wait:insurer', headline: 'x', label: 'Realizar visita del perito' },
  ballInCourt: { primary: 'insurer', holders: [holder('insurer', 'Mapfre')] },
  attention: { count: 0, tasks: [] },
  ...over,
});
const attention = situation({
  situation: 'requires_attention',
  nextStep: { kind: 'human', code: 'human_task', headline: 'x', label: 'Crear tarea — #INC-2024-0087' },
  ballInCourt: { primary: 'administration', holders: [holder('administration', 'Crear tarea', 'task')] },
  attention: {
    count: 1,
    tasks: [{ id: 't1', title: 'Crear tarea — #INC-2024-0087', kind: null, priority: 'Normal', dueAt: '2026-10-28T09:00:00Z', overdue: false, route: '/b/tasks?task=t1' }],
  },
});

describe('IssueDetailPageComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  async function setup(view: object = situation(), found: object | null = issue) {
    const h = setupComponent(IssueDetailPageComponent, {
      user: makeUser(),
      providers: [{ provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'i1' })) } }],
    });
    h.fixture.detectChanges();
    await settle();
    // Las comunidades del selector de la cabecera.
    h.http.expectOne(`${API}/estates`).flush([estate, { ...estate, id: 'e2', name: 'Comunidad Norte' }]);
    flushLoad(h, view, found);
    await settle();
    // La comunidad se pide cuando ya se conoce la incidencia.
    h.http.match(`${API}/estates/e1`).forEach((r) => r.flush(estate));
    await settle();
    h.fixture.detectChanges();
    return h;
  }
  function flushLoad(h: Awaited<ReturnType<typeof setupComponent<IssueDetailPageComponent>>>, view: object, found: object | null) {
    if (found === null) h.http.expectOne(`${API}/issues/i1`).flush('no', { status: 404, statusText: 'Not Found' });
    else h.http.expectOne(`${API}/issues/i1`).flush(found);
    h.http.expectOne(`${API}/issues/i1/situation`).flush(view);
    h.http.expectOne(`${API}/issues/i1/insurance-claims`).flush([]);
    h.http.expectOne(`${API}/issues/i1/visits`).flush([]);
    h.http.expectOne(`${API}/issues/i1/provider`).flush({
      id: 'a1', issueId: 'i1', providerNameSnapshot: 'Reparaciones del Norte S.L.', categorySnapshot: 'Albañilería', phoneSnapshot: '600111222', assignedAt: '2026-10-14', assignedByUserId: null,
    });
  }
  /** El recorrido se lee aparte (y de nuevo cada vez que cambia la situación): aquí no se comprueba, se contesta vacío. */
  const verifyAll = (http: HttpTestingController) => {
    http.match(`${API}/issues/i1/journey`).forEach((r) => r.flush({ route: null, status: 'on_track', steps: [] }));
    http.verify();
  };
  const text = (el: HTMLElement, selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

  it('the situation card shows the journey, not the state/ball/next-step columns', async () => {
    const h = await setup();
    expect(h.el.querySelector('.attention')).toBeNull();
    verifyAll(h.http);
  });

  it('has the community selector in the header, the back link above and no page title', async () => {
    const h = await setup();
    const select = h.el.querySelector<HTMLSelectElement>('app-topbar select[aria-label="Comunidad"]')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Todas mis comunidades', 'Comunidad Sol y Mar', 'Comunidad Norte',
    ]);
    // La incidencia es de Sol y Mar: es la comunidad que aparece elegida.
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Comunidad Sol y Mar');
    expect(h.el.querySelector('h1')).toBeNull();
    // Sin ruta bajo el botón: «Volver» va en la misma fila que las acciones.
    expect(h.el.querySelector('.crumbs')).toBeNull();
    expect(text(h.el, '.head a.back')).toBe('Volver a incidencias');
    expect(h.el.querySelector('.head .head__actions')).not.toBeNull();
    verifyAll(h.http);
  });

  it('goes to the list of the chosen community', async () => {
    const h = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.component.changeCommunity('e2');
    expect(navigate).toHaveBeenCalledWith(['/b/incidencias'], { queryParams: { estateId: 'e2' } });
    h.component.changeCommunity('');
    expect(navigate).toHaveBeenLastCalledWith(['/b/incidencias'], { queryParams: {} });
    verifyAll(h.http);
  });

  it('the journey asks for the current step action and the page opens the task in Tareas (no separate banner)', async () => {
    const h = await setup(attention);
    expect(h.el.querySelector('.attention')).toBeNull();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await h.component.onJourneyAction({ type: 'open_task', entityId: 't1' });
    expect(navigate).toHaveBeenCalledWith(['/b/tasks'], { queryParams: { task: 't1' } });
    verifyAll(h.http);
  });

  it('«Ver tarea» de una revisión pendiente también lleva al detalle de la tarea en Tareas', async () => {
    const review = situation({
      ...attention,
      attention: {
        count: 1,
        tasks: [{ id: 't1', title: 'Llamar al seguro — #INC-2024-0087', kind: 'review_issue', priority: 'Normal', dueAt: '2026-10-28T09:00:00Z', overdue: false, route: '/b/tasks?task=t1' }],
      },
    });
    const h = await setup(review);
    expect(h.el.querySelector('app-review-next-step-panel')).toBeNull();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await h.component.onJourneyAction({ type: 'open_task', entityId: 't1' });
    expect(navigate).toHaveBeenCalledWith(['/b/tasks'], { queryParams: { task: 't1' } });
    expect(h.component.showDecision()).toBe(false);
    verifyAll(h.http);
  });

  it('«Cambiar vía» and «Definir siguiente paso» from the journey open the route and the activity dialogs', async () => {
    const h = await setup();
    await h.component.onJourneyAction({ type: 'change_route' });
    expect(h.component.showRoute()).toBe(true);
    const opened = h.component.onJourneyAction({ type: 'register_activity' });
    expect(h.component.showRegister()).toBe(true);
    h.http.match((r) => r.url.includes('/suppliers') || r.url.includes('/agenda/assignees')).forEach((r) => r.flush([]));
    await opened;
    expect(h.component.showRegister()).toBe(true);
    verifyAll(h.http);
  });

  it('choosing how an issue without next step goes on opens «Registrar actividad» with that option', async () => {
    const h = await setup();
    const opened = h.component.openRegister('other', false, { nextStep: 'visit' });
    h.http.match((r) => r.url.includes('/suppliers') || r.url.includes('/agenda/assignees')).forEach((r) => r.flush([]));
    await opened;
    expect(h.component.showRegister()).toBe(true);
    expect(h.component.registerPreset()).toMatchObject({ nextStep: 'visit' });
    verifyAll(h.http);
  });

  it('offers «Ver tarea» in the header whenever the issue has an open task, and not otherwise', async () => {
    const withTask = await setup(attention);
    const button = withTask.el.querySelector<HTMLButtonElement>('.head__actions [data-action="view-task"] button');
    expect(button?.textContent).toContain('Ver tarea');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button!.click();
    expect(navigate).toHaveBeenCalledWith('/b/tasks?task=t1');
    verifyAll(withTask.http);
    TestBed.resetTestingModule();

    const waiting = await setup(situation({ nextStep: { kind: 'waiting', code: 'wait:insurer', headline: 'x', label: 'x', task: attention.attention.tasks[0] } }));
    expect(waiting.el.querySelector('.head__actions [data-action="view-task"]')).not.toBeNull();
    verifyAll(waiting.http);
    TestBed.resetTestingModule();

    const none = await setup(situation());
    expect(none.el.querySelector('.head__actions [data-action="view-task"]')).toBeNull();
    verifyAll(none.http);
  });

  it('shows who reported it, where it is and who is assigned', async () => {
    const h = await setup();
    expect(text(h.el, '#req-title + .who')).toContain('María García López');
    expect(text(h.el, '#req-title + .who')).not.toContain('Origen');
    // La comunidad va en el resumen de la incidencia; no hay una tarjeta aparte con su dirección.
    expect(text(h.el, '.summary')).toContain('Comunidad Sol y Mar');
    expect(h.el.querySelector('#com-title')).toBeNull();
    expect(h.el.querySelector('a[href*="google.com/maps"]')).toBeNull();
    expect(text(h.el, '#prov-title ~ strong')).toBe('Reparaciones del Norte S.L.');
    verifyAll(h.http);
  });

  it('changes the status through the domain API and reads the issue again', async () => {
    const h = await setup();
    // El estado se cambia desde el resumen, no desde la cabecera.
    expect(h.el.querySelector('.status-btn')).toBeNull();
    expect(h.el.querySelector('.head__actions')!.textContent).not.toContain('Cambiar estado');
    const row = h.el.querySelector('.summary [data-testid="status-row"]')!;
    expect(row.textContent).toContain('Estado actual');
    h.component.changeStatus('Resuelta');
    await settle();
    const patch = h.http.expectOne(`${API}/issues/i1/status`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ status: 'Resuelta' });
    patch.flush({ ...issue, status: 'Resuelta' });
    await settle();
    flushLoad(h, situation({ situation: 'completed' }), { ...issue, status: 'Resuelta' });
    await settle();
    h.fixture.detectChanges();
    expect(text(h.el, '.summary [data-testid="status-row"] .dd__value')).toBe('Resuelta');
    verifyAll(h.http);
  });

  it('shows the last update next to the status: the latest of the issue and its history', async () => {
    const h = await setup();
    h.component.issue.set({ ...issue, updatedAt: '2026-10-27T12:34:00Z', timeline: [{ kind: 'note', text: 'x', date: '2026-10-29T08:15:00Z' }] } as never);
    h.fixture.detectChanges();
    const fact = h.el.querySelector('.summary [data-testid="last-update"]')?.textContent ?? '';
    expect(fact).toContain('Actualizada el');
    expect(fact).toMatch(/29 oct 2026/);
    verifyAll(h.http);
  });

  it('explains why an issue cannot be closed instead of showing a load error', async () => {
    const h = await setup();
    h.component.changeStatus('Cerrada');
    await settle();
    h.http.expectOne(`${API}/issues/i1/status`).flush(
      { code: 'ISSUE_HAS_OPEN_INSURANCE_CLAIM', message: 'técnico' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    flushLoad(h, situation(), issue);
    await settle();
    h.fixture.detectChanges();
    const notice = text(h.el, '.notice') ?? '';
    expect(notice).toContain('No puedes cerrar esta incidencia porque todavía tiene un siniestro abierto.');
    expect(notice).not.toContain('ISSUE_HAS_OPEN_INSURANCE_CLAIM');
    expect(h.component.error()).toBe('');
    verifyAll(h.http);
  });

  it('says so when the issue does not exist or is not accessible', async () => {
    const h = await setup(situation(), null);
    expect(text(h.el, '.state')).toContain('No se ha encontrado la incidencia');
    verifyAll(h.http);
  });

  it('adds a note to the history', async () => {
    const h = await setup();
    h.component.noteText.set('Llamado el perito');
    const add = h.component.addNote();
    const post = h.http.expectOne((req) => req.url === `${API}/issues/i1/timeline` && req.method === 'POST');
    expect(post.request.body).toEqual(expect.objectContaining({ text: 'Llamado el perito' }));
    post.flush({ date: '2026-10-25', author: 'Admin', role: 'Administrador', text: 'Llamado el perito' });
    await add;
    expect(h.component.issue()?.timeline).toHaveLength(1);
    expect(h.component.noteText()).toBe('');
    verifyAll(h.http);
  });
  describe('acciones del expediente', () => {
    /** Cada acción termina volviendo a leer el expediente: se responde a esas cinco lecturas. */
    async function reload(h: Awaited<ReturnType<typeof setup>>) {
      await settle();
      flushLoad(h, situation(), issue);
      await settle();
      h.fixture.detectChanges();
    }

    it('opens the installation dialog from the menu and reloads the issue after saving', async () => {
      const h = await setup();
      h.el.querySelector<HTMLButtonElement>('.more-btn')!.click();
      h.fixture.detectChanges();
      const items = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]')).map((b) => b.textContent?.trim());
      expect(items).toEqual(['Resolver vía', 'Cambiar instalación', 'Eliminar incidencia']);
      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]'))
        .find((b) => b.textContent?.includes('instalación'))!.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-issue-edit-dialog [role="dialog"]')).not.toBeNull();
      expect(h.el.querySelector('.menu')).toBeNull();
      // El diálogo de instalación pide las de la comunidad.
      h.http.expectOne(`${API}/estates/e1/assets`).flush([]);
      const saved = h.component.editSaved('Instalación actualizada');
      await reload(h);
      await saved;
      h.fixture.detectChanges();
      expect(h.component.editing()).toBeNull();
      expect(h.el.querySelector('app-issue-edit-dialog')).toBeNull();
      expect(h.component.toast()).toBe('Instalación actualizada');
      verifyAll(h.http);
    });

    it('changes the resolution route and reads the issue again', async () => {
      const h = await setup();
      const done = h.component.changeRoute('community_insurance');
      const put = h.http.expectOne(`${API}/issues/i1/resolution-route`);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ route: 'community_insurance' });
      put.flush({ resolutionRoute: 'community_insurance', changed: true });
      await settle();
      flushLoad(h, situation(), issue);
      await done;
      expect(h.component.toast()).toBe('Vía de gestión actualizada');
      verifyAll(h.http);
    });

    it('changes the resolution route from a pop-up opened from the three-dots menu', async () => {
      const h = await setup();
      h.el.querySelector<HTMLButtonElement>('.more-btn')!.click();
      h.fixture.detectChanges();
      const menu = h.el.querySelector('.menu')!;
      expect(menu.querySelector('select')).toBeNull();
      expect(menu.firstElementChild?.textContent?.trim()).toBe('Resolver vía');
      menu.querySelector<HTMLButtonElement>('[data-action="resolve-route"]')!.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.menu')).toBeNull();
      const dialog = h.el.querySelector('app-route-dialog')!;
      expect(dialog).not.toBeNull();
      const select = dialog.querySelector<HTMLSelectElement>('select[aria-label="Vía de gestión"]')!;
      expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['Selecciona una vía', 'Proveedor (sin seguro)', 'Seguro de la comunidad', 'Seguro del propietario', 'Administrador']);
      select.value = 'community_insurance';
      select.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      h.fixture.detectChanges();
      const put = h.http.expectOne(`${API}/issues/i1/resolution-route`);
      expect(put.request.body).toEqual({ route: 'community_insurance' });
      put.flush({ resolutionRoute: 'community_insurance', changed: true });
      await settle();
      flushLoad(h, situation(), issue);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-route-dialog')).toBeNull();
      verifyAll(h.http);
    });

    it('deletes the issue from the three-dots menu, only after confirming, and goes back to the list', async () => {
      const h = await setup();
      const ask = vi.spyOn(TestBed.inject(ConfirmDialogService), 'ask').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const open = () => {
        h.el.querySelector<HTMLButtonElement>('.more-btn')!.click();
        h.fixture.detectChanges();
        return h.el.querySelector<HTMLButtonElement>('[data-action="delete-issue"]')!;
      };
      expect(open().textContent?.trim()).toBe('Eliminar incidencia');
      // Si no confirma, no se pide nada al servidor.
      await h.component.deleteIssue();
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Eliminar incidencia', tone: 'danger' }));
      h.http.expectNone(`${API}/issues/i1`);
      const done = h.component.deleteIssue();
      await settle();
      const del = h.http.expectOne(`${API}/issues/i1`);
      expect(del.request.method).toBe('DELETE');
      del.flush({ deleted: true });
      await done;
      expect(navigate).toHaveBeenCalledWith(['/b/incidencias'], { queryParams: { estateId: 'e1' } });
      verifyAll(h.http);
    });

    it('registers a management action with the counterpart and reloads', async () => {
      const h = await setup();
      const open = h.component.openRegister('insurer');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      h.http.expectOne(`${API}/agenda/assignees`).flush([]);
      await open;
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-register-interaction-dialog')).not.toBeNull();
      const done = h.component.submitRegister({ channel: 'phone', direction: 'outbound', party: 'insurer', summary: 'Llamada al perito' } as never);
      const post = h.http.expectOne(`${API}/issues/i1/interactions`);
      expect(post.request.body).toMatchObject({ party: 'insurer', summary: 'Llamada al perito' });
      post.flush({});
      await settle();
      flushLoad(h, situation(), issue);
      await done;
      expect(h.component.showRegister()).toBe(false);
      expect(h.component.toast()).toBe('Gestión registrada');
      verifyAll(h.http);
    });

    it('shows the reason and keeps the dialog when the management action is refused', async () => {
      const h = await setup();
      const open = h.component.openRegister('provider');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      h.http.expectOne(`${API}/agenda/assignees`).flush([]);
      await open;
      const done = h.component.submitRegister({ channel: 'phone', direction: 'outbound', party: 'provider', summary: 'x' } as never);
      h.http.expectOne(`${API}/issues/i1/interactions`).flush({ message: 'Falta la contraparte' }, { status: 400, statusText: 'Bad Request' });
      await done;
      expect(h.component.interactionError()).toBe('Falta la contraparte');
      expect(h.component.showRegister()).toBe(true);
      verifyAll(h.http);
    });

    it('records the outcome of a visit and shows the server reason if it fails', async () => {
      const h = await setup();
      const done = h.component.recordVisitOutcome({ visitId: 'v1', outcome: 'completed' });
      const patch = h.http.expectOne(`${API}/issues/i1/visits/v1`);
      expect(patch.request.body).toEqual({ outcome: 'completed' });
      patch.flush({ visitId: 'v1', status: 'realizada', followUp: false });
      await settle();
      flushLoad(h, situation(), issue);
      await done;
      expect(h.component.toast()).toBe('Visita registrada como realizada');

      const failing = h.component.recordVisitOutcome({ visitId: 'v2', outcome: 'cancelled' });
      h.http.expectOne(`${API}/issues/i1/visits/v2`).flush({ message: 'La visita ya tiene resultado' }, { status: 409, statusText: 'Conflict' });
      await settle();
      flushLoad(h, situation(), issue);
      await failing;
      expect(h.component.visitError()).toBe('La visita ya tiene resultado');
      verifyAll(h.http);
    });

    it('updates the status of an insurance claim', async () => {
      const h = await setup();
      const done = h.component.changeClaimStatus({ claimId: 'c1', status: 'accepted' });
      const patch = h.http.expectOne(`${API}/issues/i1/insurance-claims/c1`);
      expect(patch.request.body).toEqual({ status: 'accepted' });
      patch.flush({});
      await settle();
      flushLoad(h, situation(), issue);
      await done;
      expect(h.component.toast()).toBe('Estado del siniestro actualizado');
      verifyAll(h.http);
    });
  });

  describe('zona, información pedida y notas internas', () => {
    const waiting = { ...issue, status: 'PendienteInformacion', statusBeforeInfoRequest: 'En reparación', location: 'Portal 1', rating: null };
    const waitingView = situation({
      nextStep: { kind: 'waiting', code: 'info_request', headline: 'Esperando a un tercero', label: 'Esperando la respuesta del solicitante' },
      ballInCourt: { primary: 'owner', holders: [holder('owner', 'Quien avisó', 'status')] },
    });

    it('shows the zone the reporter chose and no category', async () => {
      const h = await setup(situation(), { ...issue, location: 'Garaje' });
      expect(h.el.querySelector('[data-category]')).toBeNull();
      expect(text(h.el, '.summary__meta')).toContain('Garaje');
      verifyAll(h.http);
    });

    it('asks the reporter for information: the issue waits on them and the banner says so', async () => {
      const h = await setup(situation(), { ...issue, status: 'EnReparacion' });
      h.component.openAskInfo();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-request-info-dialog')).not.toBeNull();
      const done = h.component.submitAskInfo('¿Desde cuándo gotea?');
      const post = h.http.expectOne(`${API}/issues/i1/request-info`);
      expect(post.request.body).toEqual({ text: '¿Desde cuándo gotea?' });
      post.flush({ ...issue, status: 'PendienteInformacion' });
      await settle();
      flushLoad(h, waitingView, waiting);
      await done;
      h.fixture.detectChanges();
      expect(h.component.toast()).toBe('Información solicitada');
      expect(h.el.querySelector('app-request-info-dialog')).toBeNull();
      expect(text(h.el, '[data-info-banner]')).toContain('Esperando la respuesta del solicitante');
      expect(text(h.el, '[data-info-banner]')).toContain('«En reparación»');
      verifyAll(h.http);
    });

    it('keeps the dialog open and says why when the server refuses', async () => {
      const h = await setup();
      h.component.openAskInfo();
      const done = h.component.submitAskInfo('¿Qué puerta?');
      h.http.expectOne(`${API}/issues/i1/request-info`).flush({ message: 'No se puede pedir información sobre una incidencia ya cerrada.' }, { status: 400, statusText: 'Bad Request' });
      await done;
      expect(h.component.askInfoError()).toBe('No se puede pedir información sobre una incidencia ya cerrada.');
      expect(h.component.showAskInfo()).toBe(true);
      verifyAll(h.http);
    });

    it('does not offer «Pedir información», «Editar proveedor» or «Editar presupuesto» in the three-dots menu', async () => {
      const open = await setup();
      open.el.querySelector<HTMLButtonElement>('.more-btn')!.click();
      open.fixture.detectChanges();
      expect(open.el.querySelector('[data-action="ask-info"]')).toBeNull();
      expect(open.el.querySelector('.menu')!.textContent).not.toMatch(/Editar proveedor|Editar presupuesto/);
      verifyAll(open.http);
    });

    it('puts «Resolver vía» top right of the summary, «Registrar actividad» in the header and the photos last in the summary', async () => {
      const summary = () => h.el.querySelector('.summary')!;
      const withPhotos = { ...issue, photos: [{ id: 'p1', url: '/p1.png' }, { id: 'p2', url: '/p2.png' }] };
      const h = await setup(situation(), withPhotos);
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:foto', revokeObjectURL: () => undefined }));
      for (const id of ['p1', 'p2']) {
        h.http.expectOne(`${API}/issues/i1/photos/${id}/file`).flush(new Blob(['x'], { type: 'image/png' }));
        await settle();
      }
      h.fixture.detectChanges();
      expect(summary().querySelectorAll('[data-photos] img')).toHaveLength(2);
      // La vía decidida se ve como una etiqueta del resumen; elegirla se hace desde el menú de tres puntos.
      expect(text(h.el, '.summary [data-testid="route-pill"]')).toBe('Vía: Por determinar');
      expect(summary().querySelector('select[aria-label="Resolver vía"]')).toBeNull();
      expect(h.el.querySelector('.sit select')).toBeNull();
      // Arriba solo quedan «Registrar actividad» y el menú de tres puntos.
      const actions = Array.from(h.el.querySelectorAll('.head__actions > *')).map((e) => e.textContent?.trim());
      expect(actions).not.toContain('Registrar actividad');
      expect(actions).toEqual(['']);
      // Las fotos ya no son una tarjeta aparte: es lo último del resumen.
      expect(h.el.querySelector('#photos-title')).toBeNull();
      expect(summary().lastElementChild?.hasAttribute('data-photos')).toBe(true);
      verifyAll(h.http);
    });

    it('puts «Pedir información» and «Informar al solicitante» in the requester card, not in the situation', async () => {
      const h = await setup();
      const labels = (selector: string) =>
        Array.from(h.el.querySelectorAll(`${selector} app-btn`)).map((b) => b.textContent?.trim());
      expect(h.el.querySelector('.sit__actions')).toBeNull();
      expect(labels('.who-actions')).toEqual(['Informar', 'Pedir información']);
      verifyAll(h.http);
    });

    it('does not offer «Pedir información» on a withdrawn issue', async () => {
      const withdrawn = await setup(situation({ situation: 'completed', ballInCourt: { primary: 'nobody', holders: [] } }), { ...issue, status: 'Retirada' });
      withdrawn.el.querySelector<HTMLButtonElement>('.more-btn')!.click();
      withdrawn.fixture.detectChanges();
      expect(withdrawn.el.querySelector('[data-action="ask-info"]')).toBeNull();
      expect(withdrawn.component.active()).toBe(false);
      verifyAll(withdrawn.http);
    });

    it('writes an internal note that the reporter never sees', async () => {
      const h = await setup();
      h.component.noteText.set('Proveedor caro, buscar otro');
      h.component.noteInternal.set(true);
      const done = h.component.addNote();
      const post = h.http.expectOne(`${API}/issues/i1/timeline`);
      expect(post.request.body).toEqual({ text: 'Proveedor caro, buscar otro', internal: true });
      post.flush({ date: '2026-10-25', author: 'Gestora', role: 'Administrador', text: 'Proveedor caro, buscar otro', internal: true });
      await done;
      h.fixture.detectChanges();
      expect(h.component.noteInternal()).toBe(false);
      expect(h.component.toast()).toBe('Nota interna añadida');
      expect(text(h.el, '.tl__lead')).toBe('Nota interna');
      verifyAll(h.http);
    });

    it('shows the rating given by the reporter', async () => {
      const h = await setup(situation({ situation: 'completed' }), { ...issue, status: 'Resuelta', rating: 4, ratingComment: 'Rápido' });
      expect(text(h.el, '[data-rating]')).toContain('4/5');
      expect(text(h.el, '[data-rating]')).toContain('Rápido');
      verifyAll(h.http);
    });
  });
});
