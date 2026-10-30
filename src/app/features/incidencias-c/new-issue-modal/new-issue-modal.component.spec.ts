import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { issueDetail } from '../testing/owner-issue-fixtures';
import { NewIssueModalComponent, type IssueCommunity, type IssueCreated } from './new-issue-modal.component';

const C1: IssueCommunity = { id: 'e1', name: 'Colón 24' };
const C2: IssueCommunity = { id: 'e2', name: 'Cuba 18' };
const LOCATIONS = [{ label: 'Zona común' }, { label: 'Ascensor A' }, { label: 'Portal 1' }, { label: 'Garaje' }];
const DRAFT_KEY = 'domora.issueDraft.u1';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('NewIssueModalComponent', () => {
  let h: ComponentHarness<NewIssueModalComponent>;
  let created: IssueCreated[];
  let affected: string[];
  let closed: number;

  async function mount(opts: { estateId?: string | null; communities?: IssueCommunity[] } = {}) {
    h = setupComponent(NewIssueModalComponent, { user: makeUser({ id: 'u1' }) });
    h.fixture.componentRef.setInput('communities', opts.communities ?? [C1, C2]);
    h.fixture.componentRef.setInput('estateId', opts.estateId === undefined ? 'e1' : opts.estateId);
    h.fixture.componentRef.setInput('userId', 'u1');
    created = [];
    affected = [];
    closed = 0;
    h.component.created.subscribe((c) => created.push(c));
    h.component.affected.subscribe((id) => affected.push(id));
    h.component.closed.subscribe(() => closed++);
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }

  function flushLocations(estateId = 'e1') {
    h.http.expectOne(`${API}/me/issues/locations?estateId=${estateId}`).flush(LOCATIONS);
  }

  async function render() {
    await settle();
    h.fixture.detectChanges();
  }

  function type(selector: string, value: string) {
    const field = h.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
  }

  function choose(selector: string, value: string) {
    const select = h.el.querySelector<HTMLSelectElement>(selector)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
  }

  function click(selector: string) {
    h.el.querySelector<HTMLButtonElement>(selector)!.click();
    h.fixture.detectChanges();
  }

  function pickFiles(selector: string, files: File[]) {
    const input = h.el.querySelector<HTMLInputElement>(selector)!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
  }

  async function fillValid() {
    flushLocations();
    await render();
    type('[data-field="title"]', 'Luz fundida');
    type('[data-field="description"]', 'No funciona la luz del rellano');
    choose('[data-field="location"]', 'Garaje');
    click('[data-urgent="no"]');
  }

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // no storage
    }
  });

  afterEach(() => h?.http.verify());

  it('is an accessible dialog that focuses its first editable field and closes with Escape', async () => {
    await mount();
    flushLocations();
    await render();
    const dialog = h.el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(text(dialog.querySelector('h2'))).toBe('Nueva incidencia');
    expect(document.activeElement).toBe(h.el.querySelector('[data-field="title"]'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('with «Todas» asks for the community among the available ones, and loads its zones once chosen', async () => {
    await mount({ estateId: null });
    const select = h.el.querySelector<HTMLSelectElement>('[data-field="estate"]')!;
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Selecciona una comunidad', 'Colón 24', 'Cuba 18']);
    h.http.expectNone((r) => r.url.endsWith('/me/issues/locations'));
    click('button[type="submit"]');
    expect(text(h.el.querySelector('[data-error="estate"]'))).toBe('Elige la comunidad.');
    choose('[data-field="estate"]', 'e2');
    await settle();
    flushLocations('e2');
    expect(h.el.querySelector('[data-field="property"]')).toBeNull();
  });

  it('with a community selected the community is shown but fixed', async () => {
    await mount();
    flushLocations();
    await render();
    const estate = h.el.querySelector<HTMLSelectElement>('[data-field="estate"]')!;
    expect(estate.disabled).toBe(true);
    expect(estate.value).toBe('e1');
  });

  it('offers the zones and installations of the community — never the owner’s home — and a free «Otra…»', async () => {
    await mount();
    flushLocations();
    await render();
    const options = Array.from(h.el.querySelectorAll<HTMLOptionElement>('[data-field="location"] option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Selecciona una zona o instalación', 'Zona común', 'Ascensor A', 'Portal 1', 'Garaje', 'Otra…']);
    expect(options.some((o) => /vivienda/i.test(o ?? ''))).toBe(false);
  });

  it('never asks what kind of ticket it is: the only type is the optional «Tipo de incidencia»', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-category]')).toBeNull();
    expect(h.el.querySelector('.segmented[aria-labelledby="new-issue-type-label"]')).toBeNull();
    const subtypes = Array.from(h.el.querySelectorAll<HTMLOptionElement>('[data-field="subtype"] option')).map((o) => o.textContent?.trim());
    expect(subtypes).toEqual(['Sin especificar', 'Avería', 'Ruido', 'Daño estructural', 'Fuga', 'Seguridad', 'Limpieza', 'Otro']);
  });

  it('creates the issue in the community with the subtype, the urgency answer and the chosen zone, uploads the files one by one and reports it', async () => {
    await mount();
    flushLocations();
    await render();
    choose('[data-field="subtype"]', 'Fuga');
    type('[data-field="title"]', 'Gotera');
    type('[data-field="description"]', 'Cae agua');
    choose('[data-field="location"]', 'Garaje');
    expect(text(h.el.querySelector('[data-urgency]'))).toContain('¿Hay riesgo o daños activos (agua, electricidad, personas atrapadas)?');
    click('[data-urgent="yes"]');
    const photo = new File(['x'], 'gotera.jpg', { type: 'image/jpeg' });
    const pdf = new File(['x'], 'parte.pdf', { type: 'application/pdf' });
    pickFiles('[data-field="files"]', [photo, pdf]);
    expect(Array.from(h.el.querySelectorAll('[data-file-chip] .chip__name')).map(text)).toEqual(['gotera.jpg', 'parte.pdf']);
    expect(Array.from(h.el.querySelectorAll('[data-file-chip] button')).map(text)).toEqual(['Quitar gotera.jpg', 'Quitar parte.pdf']);
    click('button[type="submit"]');
    const post = h.http.expectOne(`${API}/me/issues`);
    expect(post.request.body).toEqual({ estateId: 'e1', type: 'Fuga', title: 'Gotera', description: 'Cae agua', location: 'Garaje', urgent: true });
    post.flush(issueDetail({ id: 'new1' }));
    await settle();
    const first = h.http.expectOne(`${API}/issues/new1/photos`);
    expect(((first.request.body as FormData).get('file') as File).name).toBe('gotera.jpg');
    h.http.expectNone(`${API}/issues/new1/photos`);
    first.flush({ id: 'a1' });
    await settle();
    const second = h.http.expectOne(`${API}/issues/new1/photos`);
    expect(((second.request.body as FormData).get('file') as File).name).toBe('parte.pdf');
    second.flush({ id: 'a2' });
    await settle();
    expect(created).toEqual([{ id: 'new1', failedUploads: [] }]);
  });

  it('without a subtype sends no type, the urgency answer is always asked and removing a chip drops the file', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-urgency]')).not.toBeNull();
    type('[data-field="title"]', 'Puerta del portal');
    type('[data-field="description"]', 'No cierra bien');
    choose('[data-field="location"]', 'Garaje');
    click('[data-urgent="no"]');
    pickFiles('[data-field="files"]', [new File(['x'], 'dni.pdf', { type: 'application/pdf' })]);
    click('[data-file-chip] button');
    expect(h.el.querySelector('[data-file-chip]')).toBeNull();
    click('button[type="submit"]');
    const post = h.http.expectOne(`${API}/me/issues`);
    expect(post.request.body).toEqual({ estateId: 'e1', title: 'Puerta del portal', description: 'No cierra bien', location: 'Garaje', urgent: false });
    post.flush(issueDetail({ id: 'new2' }));
    await settle();
    expect(created).toEqual([{ id: 'new2', failedUploads: [] }]);
  });

  it('«Otra…» reveals a free-text zone, with no scope to choose', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-field="other-location"]')).toBeNull();
    type('[data-field="title"]', 'Banco roto');
    type('[data-field="description"]', 'El banco del jardín está roto');
    choose('[data-field="location"]', '__other__');
    type('[data-field="other-location"]', 'Jardín trasero');
    expect(h.el.querySelector('[data-other-scope]')).toBeNull();
    click('[data-urgent="no"]');
    await wait(350);
    h.http.expectOne((r) => r.url === `${API}/me/issues/similar`).flush([]);
    click('button[type="submit"]');
    const post = h.http.expectOne(`${API}/me/issues`);
    expect(post.request.body).toMatchObject({ estateId: 'e1', location: 'Jardín trasero', urgent: false });
    expect(post.request.body).not.toHaveProperty('scope');
    expect(post.request.body).not.toHaveProperty('propertyId');
    post.flush(issueDetail({ id: 'new3' }));
    await settle();
  });

  it('required fields and the urgency answer are checked before sending', async () => {
    await mount();
    flushLocations();
    await render();
    click('button[type="submit"]');
    expect(text(h.el.querySelector('[data-error="title"]'))).toBe('Cuéntanos qué ha pasado.');
    expect(text(h.el.querySelector('[data-error="description"]'))).toBe('Describe lo que ocurre.');
    expect(text(h.el.querySelector('[data-error="location"]'))).toBe('Elige dónde ocurre.');
    expect(text(h.el.querySelector('[data-error="urgent"]'))).toBe('Indica si hay riesgo o daños activos.');
    h.http.expectNone(`${API}/me/issues`);
  });

  it('rejects files over 10 MB or of another type on the client', async () => {
    await mount();
    flushLocations();
    await render();
    const big = new File(['x'], 'video.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    const doc = new File(['x'], 'acta.docx', { type: 'application/msword' });
    pickFiles('[data-field="files"]', [big, doc]);
    expect(h.el.querySelector('[data-file-chip]')).toBeNull();
    expect(text(h.el.querySelector('[data-error="files"]'))).toBe('«video.jpg» supera los 10 MB. «acta.docx» no es una imagen ni un PDF.');
  });

  it('shows the backend message when creating fails', async () => {
    await mount();
    await fillValid();
    click('button[type="submit"]');
    h.http.expectOne(`${API}/me/issues`).flush({ message: ['title must be shorter than or equal to 200 characters'] }, { status: 400, statusText: 'Bad Request' });
    await render();
    expect(text(h.el.querySelector('[data-form-error]'))).toBe('title must be shorter than or equal to 200 characters');
    expect(created).toEqual([]);
  });

  it('suggests similar open issues while typing the subject and «Me afecta también» marks it instead of creating a duplicate', async () => {
    await mount();
    flushLocations();
    await render();
    type('[data-field="title"]', 'Ascensor parado');
    h.http.expectNone((r) => r.url === `${API}/me/issues/similar`);
    await wait(350);
    const req = h.http.expectOne((r) => r.url === `${API}/me/issues/similar`);
    expect(req.request.params.get('estateId')).toBe('e1');
    expect(req.request.params.get('q')).toBe('Ascensor parado');
    req.flush(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `Ascensor ${i}`, status: 'Abierta', location: 'Ascensor', affectedCount: i, affectedByMe: false })));
    await render();
    expect(h.el.querySelectorAll('[data-similar-item]').length).toBe(5);
    h.el.querySelector<HTMLButtonElement>('[data-similar-item="s1"] button')!.click();
    const put = h.http.expectOne(`${API}/me/issues/s1/affected`);
    expect(put.request.method).toBe('PUT');
    put.flush(issueDetail({ id: 's1', mine: false }));
    await settle();
    expect(affected).toEqual(['s1']);
    h.http.expectNone(`${API}/me/issues`);
  });

  it('does not look for similar issues until the subject has a searchable word', async () => {
    await mount();
    flushLocations();
    await render();
    type('[data-field="title"]', 'Luz');
    await wait(350);
    h.http.expectNone((r) => r.url === `${API}/me/issues/similar`);
  });

  it('keeps a draft per user, restores it and clears it after creating', async () => {
    await mount();
    flushLocations();
    await render();
    type('[data-field="title"]', 'Borrador');
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toMatchObject({ title: 'Borrador' });
    h.fixture.destroy();
    await wait(350);
    h.http.match(() => true);
    TestBed.resetTestingModule();

    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector<HTMLInputElement>('[data-field="title"]')!.value).toBe('Borrador');
    expect(text(h.el.querySelector('[data-draft-restored]'))).toContain('Hemos recuperado tu borrador.');
    type('[data-field="description"]', 'Algo');
    choose('[data-field="location"]', 'Garaje');
    click('[data-urgent="no"]');
    click('button[type="submit"]');
    h.http.expectOne(`${API}/me/issues`).flush(issueDetail({ id: 'new4' }));
    await settle();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('«Cancelar» clears the draft and closes', async () => {
    await mount();
    flushLocations();
    await render();
    type('[data-field="title"]', 'Borrador');
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    click('[data-action="discard"] button');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(closed).toBe(1);
    await wait(350);
    h.http.match(() => true);
  });

  it('offers «Hacer foto» with the rear camera only on touch devices', async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }) });
    try {
      await mount();
      flushLocations();
      await render();
      const camera = h.el.querySelector<HTMLInputElement>('[data-take-photo] input[type=file]')!;
      expect(text(h.el.querySelector('[data-take-photo]'))).toContain('Hacer foto');
      expect(camera.getAttribute('capture')).toBe('environment');
      expect(camera.accept).toBe('image/*');
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });

  it('offers no camera button on desktop', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-take-photo]')).toBeNull();
    const files = h.el.querySelector<HTMLInputElement>('[data-field="files"]')!;
    expect(files.multiple).toBe(true);
    expect(files.accept).toBe('image/*,application/pdf');
  });
  it('answering «Sí» shows the response time and the 112 advice; «No» hides them', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-urgent-notice]')).toBeNull();
    click('[data-urgent="yes"]');
    expect(h.el.querySelector('[data-urgent="yes"]')!.getAttribute('aria-checked')).toBe('true');
    const notice = text(h.el.querySelector('[data-urgent-notice]'));
    expect(notice).toContain('Tiempo de respuesta estimado: 24 horas');
    expect(notice).toContain('llama al 112');
    click('[data-urgent="no"]');
    expect(h.el.querySelector('[data-urgent-notice]')).toBeNull();
  });

  it('counts the characters of the subject and the description', async () => {
    await mount();
    flushLocations();
    await render();
    type('[data-field="title"]', 'Luz');
    type('[data-field="description"]', 'No funciona');
    const counts = Array.from(h.el.querySelectorAll('.field__count')).map(text);
    expect(counts).toEqual(['3 / 34','11 / 5000']);
  });

  it('«Añadir más detalles de la ubicación» appends the detail to the chosen zone', async () => {
    await mount();
    flushLocations();
    await render();
    expect(h.el.querySelector('[data-action="location-detail"]')).toBeNull();
    choose('[data-field="location"]', 'Garaje');
    click('[data-action="location-detail"]');
    type('[data-field="location-detail"]', 'Rampa de entrada');
    type('[data-field="title"]', 'Luz fundida');
    type('[data-field="description"]', 'No funciona la luz');
    click('[data-urgent="no"]');
    click('button[type="submit"]');
    await settle();
    const req = h.http.expectOne((r) => r.url === `${API}/me/issues` && r.method === 'POST');
    expect(req.request.body.location).toBe('Garaje · Rampa de entrada');
    req.flush({ id: 'i1' });
    await settle();
  });
});
