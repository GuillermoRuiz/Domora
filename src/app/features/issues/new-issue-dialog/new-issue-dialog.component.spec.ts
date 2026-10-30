import { API, makeUser, setupComponent, settle } from '../../../core/testing/component-harness';
import { NewIssueDialogComponent } from './new-issue-dialog.component';
import type { Issue } from '../../../core/models';

const ESTATES = [
  { id: 'e1', name: 'Los Olivos', address: 'C/ Ficus 12' },
  { id: 'e2', name: 'Edificio Luna', address: '' },
];
const ISSUE_BODY = { id: 'i9', ref: 'INC-9', estateId: 'e1', type: 'Fuga', title: 'Ascensor parado', description: 'x', status: 'Abierta', priority: 'Urgente', source: 'Comunidad', date: '2026-10-25' };

describe('NewIssueDialogComponent', () => {
  type Harness = ReturnType<typeof setupComponent<NewIssueDialogComponent>>;

  /** Responde a lo que el diálogo pide de una comunidad: instalaciones, propietarios y empleados. */
  async function flushEstate(h: Harness, estateId: string, data: { assets?: unknown[]; owners?: unknown[]; staff?: unknown[] } = {}) {
    h.http.expectOne(`${API}/estates/${estateId}/assets`).flush(data.assets ?? [{ id: 'a2', name: 'Piscina' }, { id: 'a1', name: 'Ascensor' }]);
    h.http.expectOne(`${API}/estates/${estateId}/properties/owner-emails`).flush(
      data.owners ?? [
        { email: 'zoe@olivos.es', fullName: 'Zoe Vecina', isOwner: true },
        { email: 'ana@olivos.es', userId: 'u-ana', fullName: 'Ana Dueña', isOwner: true },
        { email: 'inq@olivos.es', fullName: 'Inés Inquilina', isOwner: false },
      ],
    );
    h.http.expectOne(`${API}/estates/${estateId}/staff`).flush(
      data.staff ?? [
        { id: 's1', fullName: 'Pepe Portero', position: 'Portero', phone: '600 111 222', email: 'pepe@olivos.es', status: 'Activo' },
        { id: 's2', fullName: 'Baja Antigua', position: 'Limpieza', phone: null, email: null, status: 'Baja' },
      ],
    );
    await settle();
    h.fixture.detectChanges();
  }

  async function setup(estateId: string | null = 'e1') {
    const h = setupComponent(NewIssueDialogComponent, { user: makeUser({ fullName: 'Gestora Uno' }) });
    h.fixture.componentRef.setInput('estates', ESTATES);
    h.fixture.componentRef.setInput('estateId', estateId);
    h.fixture.detectChanges();
    if (estateId) await flushEstate(h, estateId);
    const created: Issue[] = [];
    const closed: number[] = [];
    h.component.created.subscribe((issue) => created.push(issue));
    h.component.closed.subscribe(() => closed.push(1));
    return { h, created, closed };
  }

  function fillValid(h: Harness) {
    h.component.title.set('Ascensor parado');
    h.component.description.set('No sube del sótano');
    h.component.assetId.set('a1');
    h.component.chooseReporter('admin');
    h.component.reporterContact.set('gestora@domora.es');
    h.component.route.set('community_provider');
  }

  /** La vía viaja en la propia petición de alta: ya no hay una segunda llamada para fijarla. */
  async function flushRoute(h: Harness, issueId: string, _body: Record<string, unknown> = {}) {
    await settle();
    h.http.expectNone(`${API}/issues/${issueId}/resolution-route`);
  }

  it('offers the installations of the community in alphabetical order and asks for one', async () => {
    const { h } = await setup();
    expect(h.component.installations().map((i) => i.name)).toEqual(['Ascensor', 'Piscina']);
    const field = h.el.querySelector('[data-field="installation"]')!;
    expect(field.textContent).not.toContain('opcional');
    expect(field.querySelector('.req')).not.toBeNull();
    h.http.verify();
  });

  it('does not ask for an installation when the community has none', async () => {
    const h = setupComponent(NewIssueDialogComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('estates', ESTATES);
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.detectChanges();
    await flushEstate(h, 'e1', { assets: [] });
    expect(h.component.assetRequired()).toBe(false);
    expect(h.el.querySelector('[data-field="installation"]')?.textContent).toContain('opcional');
    h.http.verify();
  });

  it('limits the title to 34 characters and counts them', async () => {
    const { h } = await setup();
    const title = h.el.querySelector('[data-field="title"]') as HTMLInputElement;
    expect(title.getAttribute('maxlength')).toBe('34');
    h.component.title.set('Fuga');
    h.fixture.detectChanges();
    expect(h.el.querySelector('.field__count')?.textContent?.trim()).toBe('4 / 34');
    h.http.verify();
  });

  it('asks for everything that is required before sending anything', async () => {
    const { h, created } = await setup();
    await h.component.submit();
    expect(h.component.errors()).toEqual({ title: true, asset: true, description: true, reporter: true, contact: true, route: true });
    expect(created).toEqual([]);
    h.http.expectNone((r) => r.method === 'POST');
    h.http.verify();
  });

  it('lists the administration itself, the owners and the active staff of the community as reporters', async () => {
    const { h } = await setup();
    const select = h.el.querySelector('[data-field="reporter"]') as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => ({
      title: g.label,
      items: Array.from(g.querySelectorAll('option')).map((o) => o.textContent?.trim()),
    }));
    expect(groups).toEqual([
      { title: 'Administración', items: ['Gestora Uno (tú)'] },
      { title: 'Propietarios', items: ['Ana Dueña', 'Zoe Vecina'] },
      { title: 'Empleados de la comunidad', items: ['Pepe Portero · Portero'] },
    ]);
    h.http.verify();
  });

  it('proposes the phone (or the email) of the chosen person as the contact', async () => {
    const { h } = await setup();
    h.component.chooseReporter('staff:s1');
    expect(h.component.reporterContact()).toBe('600 111 222');
    h.component.chooseReporter('owner:ana@olivos.es');
    expect(h.component.reporterContact()).toBe('ana@olivos.es');
    h.http.verify();
  });

  it('creates the issue in the community and hands it over with the chosen installation and reporter', async () => {
    const { h, created } = await setup();
    fillValid(h);
    h.component.title.set('  Ascensor parado ');
    h.component.type.set('Fuga');
    h.component.priority.set('Urgente');
    h.component.chooseReporter('owner:ana@olivos.es');
    const sent = h.component.submit();
    const post = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/estates/e1/issues`);
    expect(post.request.body).toMatchObject({
      title: 'Ascensor parado',
      description: 'No sube del sótano',
      priority: 'Urgente',
      assetId: 'a1',
      channel: 'call',
      // Es un propietario con cuenta: la incidencia queda a su nombre y recibe los avisos del solicitante.
      reporterUserId: 'u-ana',
      reporterName: 'Ana Dueña',
      reporterContact: 'ana@olivos.es',
      resolutionRoute: 'community_provider',
    });
    expect(post.request.body.sourceRef).toBeUndefined();
    post.flush(ISSUE_BODY);
    await flushRoute(h, 'i9');
    await sent;
    expect(created.map((i) => i.id)).toEqual(['i9']);
    h.http.verify();
  });

  it('keeps the dialog open and says why when the server refuses', async () => {
    const { h, created } = await setup();
    fillValid(h);
    const sent = h.component.submit();
    h.http
      .expectOne((r) => r.method === 'POST')
      .flush({ message: ['El título es demasiado corto'] }, { status: 400, statusText: 'Bad Request' });
    await sent;
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('El título es demasiado corto');
    expect(created).toEqual([]);
    expect(h.component.saving()).toBe(false);
  });

  it('closes from the cross', async () => {
    const { h, closed } = await setup();
    h.el.querySelector<HTMLButtonElement>('.head__close')!.click();
    expect(closed).toEqual([1]);
    h.http.verify();
  });

  it('shows the community with its address and, without one chosen, asks for it', async () => {
    const { h } = await setup(null);
    const select = h.el.querySelector('[data-field="estate"]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['Selecciona una comunidad', 'Los Olivos · C/ Ficus 12', 'Edificio Luna']);
    fillValid(h);
    await h.component.submit();
    expect(h.component.errors()).toEqual({ estate: true });
    h.http.expectNone((r) => r.method === 'POST');
    h.http.verify();
  });

  it('changing the community reloads its installations and reporters and forgets the previous choice', async () => {
    const { h } = await setup();
    fillValid(h);
    h.component.chooseEstate('e2');
    h.fixture.detectChanges();
    await flushEstate(h, 'e2', { assets: [{ id: 'b1', name: 'Garaje' }], owners: [], staff: [] });
    expect(h.component.assetId()).toBe('');
    expect(h.component.reporterKey()).toBe('');
    expect(h.component.reporters().map((r) => r.key)).toEqual(['admin']);
    h.http.verify();
  });

  it('sends the zone and uploads the photos after creating', async () => {
    const { h, created } = await setup();
    fillValid(h);
    h.component.location.set(' Piscina, bloque 1 ');
    h.component.files.set([new File(['x'], 'gotera.jpg', { type: 'image/jpeg' })]);
    const sent = h.component.submit();
    const post = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/estates/e1/issues`);
    expect(post.request.body).toMatchObject({ location: 'Piscina, bloque 1', reporterName: 'Gestora Uno', reporterContact: 'gestora@domora.es' });
    // La propia gestión y los empleados no tienen cuenta de propietario: solo se guarda su nombre y su contacto.
    expect(post.request.body.reporterUserId).toBeUndefined();
    post.flush({ ...ISSUE_BODY, id: 'i7' });
    await flushRoute(h, 'i7');
    const photo = h.http.expectOne(`${API}/issues/i7/photos`);
    expect(((photo.request.body as FormData).get('file') as File).name).toBe('gotera.jpg');
    photo.flush({ id: 'p1' });
    await sent;
    expect(created.map((i) => i.id)).toEqual(['i7']);
    h.http.verify();
  });

  it('proposes the route from the answers, keeps the reason and lets the person change it', async () => {
    const { h } = await setup();
    const guide = h.el.querySelector('app-route-guide')!;
    // Solo dos preguntas, ambas desplegables; la segunda aparece si el daño no es de los que cubre el seguro.
    expect(guide.querySelector('[data-q="covered"] select')).not.toBeNull();
    expect(guide.querySelector('input[type="radio"]')).toBeNull();
    expect(guide.querySelector('[data-q="doer"]')).toBeNull();
    const instance = h.fixture.debugElement.query((d) => d.name === 'app-route-guide').componentInstance;
    instance.answer({ covered: 'no' });
    h.fixture.detectChanges();
    expect(guide.querySelector('[data-q="doer"] select')).not.toBeNull();
    expect(h.component.route()).toBeNull();
    instance.answer({ doer: 'owner' });
    expect(h.component.route()).toBe('owner_insurance');
    h.fixture.debugElement.query((d) => d.name === 'app-route-guide').componentInstance.answer({ covered: 'yes' });
    h.fixture.detectChanges();
    expect(h.component.route()).toBe('community_insurance');
    expect(h.component.routeReason()).toContain('póliza');
    expect(guide.querySelector('[data-testid="route-recommendation"]')?.textContent).toContain('Seguro de la comunidad');
    fillValid(h);
    h.component.route.set('community_insurance');
    h.component.routeReason.set('Daño sobrevenido en un elemento común: puede cubrirlo la póliza de la comunidad.');
    const sent = h.component.submit();
    const post = h.http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toMatchObject({
      resolutionRoute: 'community_insurance',
      routeReason: 'Daño sobrevenido en un elemento común: puede cubrirlo la póliza de la comunidad.',
    });
    post.flush(ISSUE_BODY);
    await flushRoute(h, 'i9');
    await sent;
    h.http.verify();
  });

  it('splits the form in two parts: the incident and its additional information', async () => {
    const { h } = await setup();
    const main = h.el.querySelector<HTMLElement>('[data-step="main"]')!;
    const extra = h.el.querySelector<HTMLElement>('[data-step="extra"]')!;
    expect(main.hidden).toBe(false);
    expect(extra.hidden).toBe(true);
    expect(main.querySelector('[data-field="title"]')).not.toBeNull();
    expect(main.querySelector('[data-section="route"]')).toBeNull();
    expect(extra.querySelector('[data-section="route"]')).not.toBeNull();
    expect(extra.querySelector('[data-field="reporter"]')).not.toBeNull();
    h.el.querySelector<HTMLButtonElement>('[data-step-tab="extra"]')!.click();
    h.fixture.detectChanges();
    expect(main.hidden).toBe(true);
    expect(extra.hidden).toBe(false);
    // Un fallo en la primera parte lleva de vuelta a ella.
    await h.component.submit();
    h.fixture.detectChanges();
    expect(h.component.step()).toBe('main');
    h.http.verify();
  });

  it('always shows the additional information: channel, who reported and how to reach them', async () => {
    const { h } = await setup();
    expect(h.el.querySelector('[data-field="channel"]')).not.toBeNull();
    expect(h.el.querySelector('[data-field="reporter"]')).not.toBeNull();
    expect(h.el.querySelector('[data-field="reporter-contact"]')).not.toBeNull();
    expect(h.el.querySelector('[data-field="source-ref"]')).toBeNull();
    expect(h.el.querySelector('[data-action="extra"]')).toBeNull();
    h.http.verify();
  });
});
