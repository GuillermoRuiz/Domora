import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { HttpErrorResponse } from '@angular/common/http';
import { API, makeUser, setupComponent, settle } from '../../../../core/testing/component-harness';
import type { Meeting } from '../../../../core/models';
import { CreateJuntaModalComponent } from './create-junta-modal.component';

const owners = [
  { email: 'lucia@demo.app', fullName: 'Lucía Fernández' },
  { email: 'javier@demo.app', fullName: 'Javier Moreno' },
];

const created = {
  id: 'm9',
  estateId: 'e1',
  title: 'Junta de enero',
  includeJitsi: false,
  waitRoomUrl: 'http://localhost/wait/m9',
  beaconUrl: 'http://localhost/beacon/m9',
} as unknown as Meeting;

async function setup() {
  const h = setupComponent(CreateJuntaModalComponent, { user: makeUser() });
  h.fixture.componentRef.setInput('estateId', 'e1');
  h.fixture.componentRef.setInput('open', true);
  h.fixture.detectChanges();
  h.http.expectOne(`${API}/estates/e1/properties/owner-emails`).flush(owners);
  await settle();
  h.fixture.detectChanges();
  return h;
}

type Harness = Awaited<ReturnType<typeof setup>>;

function fillDetails(h: Harness, title = 'Junta de enero'): void {
  const { draft } = h.component;
  draft.title.set(title);
  draft.scheduledAt1.set('2027-01-15T18:00');
  draft.scheduledAt2.set('2027-01-15T18:30');
}

function fillAgenda(h: Harness): void {
  h.component.draft.prepareAgenda();
  h.component.draft.agenda.update((items) => [{ ...items[0], title: 'Aprobación de cuentas' }]);
}

describe('CreateJuntaModalComponent (wizard)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows and posts the default ordinary agenda through the existing wizard', async () => {
    const h = await setup();
    fillDetails(h);
    h.component.next();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('[data-agenda-id]')).toHaveLength(3);
    const agenda = structuredClone(h.component.draft.agenda());
    h.component.back();
    h.component.next();
    expect(h.component.draft.agenda()).toEqual(agenda);
    h.component.next();
    h.fixture.detectChanges();
    const saving = h.component.submit();
    const req = h.http.expectOne(`${API}/estates/e1/meetings`);
    expect(req.request.body.agenda).toEqual(agenda);
    req.flush({ ...created, ...req.request.body });
    await saving;
    expect(h.component.successInfo()?.meeting.agenda).toEqual(agenda);
  });

  it('seeds immediately when the type selector changes to ordinary', async () => {
    const h = await setup();
    const select = h.el.querySelector<HTMLSelectElement>('select')!;
    // Locate by its current model rather than relying on the optional estate selector.
    const typeSelect = Array.from(h.el.querySelectorAll<HTMLSelectElement>('select')).find(s => s.value.includes('ordinaria')) ?? select;
    typeSelect.value = 'extraordinaria';
    typeSelect.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(h.component.draft.agenda().filter(i => i.systemGenerated)).toHaveLength(0);
    typeSelect.value = 'ordinaria';
    typeSelect.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(h.component.draft.agenda().filter(i => i.systemGenerated)).toHaveLength(3);
  });

  it('opens on step 1 and preselects the estate owners as attendees, with their names', async () => {
    const h = await setup();
    expect(h.component.step()).toBe(1);
    expect(h.el.querySelector('[role="dialog"]')).not.toBeNull();
    expect(h.component.draft.attendees()).toEqual([
      { email: 'lucia@demo.app', name: 'Lucía Fernández' },
      { email: 'javier@demo.app', name: 'Javier Moreno' },
    ]);
    expect(h.component.draft.isDirty()).toBe(false);
    h.http.verify();
  });

  describe('community chosen inside the wizard', () => {
    const estates = [
      { id: 'e1', name: 'Edificio Sol' },
      { id: 'e2', name: 'Edificio Luna' },
    ];
    function openWithoutEstate() {
      const h = setupComponent(CreateJuntaModalComponent, { user: makeUser() });
      h.fixture.componentRef.setInput('estates', estates);
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      return h;
    }

    it('shows the selector in step 1, loads nothing yet and blocks "Continuar" until one is chosen', () => {
      const h = openWithoutEstate();
      h.http.expectNone(`${API}/estates/e1/properties/owner-emails`);
      expect(h.el.querySelector('select[aria-label="Comunidad de la junta"]')).not.toBeNull();
      h.component.draft.title.set('Junta');
      h.component.next();
      expect(h.component.step()).toBe(1);
      expect(h.component.draft.error()?.field).toBe('estate');
      h.http.verify();
    });

    it('preselects the given community in the selector and loads its owners', async () => {
      const h = setupComponent(CreateJuntaModalComponent, { user: makeUser() });
      h.fixture.componentRef.setInput('estateId', 'e1');
      h.fixture.componentRef.setInput('estates', estates);
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/properties/owner-emails`).flush(owners);
      await settle();
      h.fixture.detectChanges();
      const select = h.el.querySelector('select[aria-label="Comunidad de la junta"]') as HTMLSelectElement;
      expect(select.value).toContain('e1');
      expect(h.component.draft.estateId()).toBe('e1');
      expect(h.component.draft.isDirty()).toBe(false);
      h.http.verify();
    });

    it('loads the owners of the chosen community and creates the junta in it', async () => {
      const h = openWithoutEstate();
      const loading = h.component.onEstateChosen('e2');
      h.http.expectOne(`${API}/estates/e2/properties/owner-emails`).flush(owners);
      await loading;
      expect(h.component.draft.estateId()).toBe('e2');
      expect(h.component.draft.attendees().map((a) => a.email)).toEqual(['lucia@demo.app', 'javier@demo.app']);
      fillDetails(h);
      fillAgenda(h);
      void h.component.submit();
      h.http.expectOne(`${API}/estates/e2/meetings`).flush({ ...created, estateId: 'e2' });
      await settle();
      h.http.verify();
    });
  });

  it('blocks "Continuar" with the step-1 validation message and marks the field', async () => {
    const h = await setup();
    h.component.next();
    expect(h.component.step()).toBe(1);
    expect(h.component.draft.error()?.message).toBe('El título es obligatorio.');
    expect(h.component.draft.errorField()).toBe('title');
    h.fixture.detectChanges();
    expect(h.el.querySelector('#junta-wizard-error')?.textContent).toContain('El título es obligatorio.');
  });

  it('moves through the steps and shows each step content', async () => {
    const h = await setup();
    fillDetails(h);
    h.component.next();
    h.fixture.detectChanges();
    expect(h.component.step()).toBe(2);
    expect(h.el.textContent).toContain('Orden del día');
    fillAgenda(h);
    h.component.next();
    h.fixture.detectChanges();
    expect(h.component.step()).toBe(3);
    expect(h.el.textContent).toContain('Asistentes');
    expect(h.el.textContent).toContain('Documentos adjuntos');
  });

  it('keeps everything typed when going back and forth between steps', async () => {
    const h = await setup();
    fillDetails(h, 'Junta con datos');
    h.component.draft.street.set('Calle Mayor 1');
    h.component.next();
    fillAgenda(h);
    h.component.next();
    h.component.draft.signerName.set('Ana Pérez');
    h.component.back();
    h.component.back();
    h.fixture.detectChanges();
    expect(h.component.step()).toBe(1);
    expect(h.component.draft.title()).toBe('Junta con datos');
    expect(h.component.draft.street()).toBe('Calle Mayor 1');
    expect(h.component.draft.agenda()[0].title).toBe('Aprobación de cuentas');
    expect(h.component.draft.signerName()).toBe('Ana Pérez');
  });

  it('clicking a future step validates the steps in between', async () => {
    const h = await setup();
    h.component.draft.setType('extraordinaria');
    h.component.goTo(3);
    expect(h.component.step()).toBe(1);
    expect(h.component.draft.error()?.step).toBe(1);
    fillDetails(h);
    h.component.goTo(3);
    expect(h.component.step()).toBe(2); // el paso 2 aún tiene un punto sin título
    expect(h.component.draft.error()?.message).toBe('Todos los puntos deben tener título.');
    fillAgenda(h);
    h.component.goTo(3);
    expect(h.component.step()).toBe(3);
    h.component.goTo(1); // hacia atrás siempre se puede
    expect(h.component.step()).toBe(1);
  });

  it('clears a validation error as soon as the user edits something', async () => {
    const h = await setup();
    h.component.next();
    expect(h.component.draft.error()).not.toBeNull();
    h.component.draft.title.set('Ya tiene título');
    h.fixture.detectChanges();
    expect(h.component.draft.error()).toBeNull();
  });

  it('step 3 offers video call and convocation signer as two dropdowns on one row', async () => {
    const h = await setup();
    h.component.step.set(3);
    h.fixture.detectChanges();
    const video = h.el.querySelector('select[aria-label="Videollamada"]') as HTMLSelectElement;
    const signer = h.el.querySelector('select[aria-label="Quién firma la convocatoria"]') as HTMLSelectElement;
    expect(video.closest('.row-2')).toBe(signer.closest('.row-2'));
    expect(Array.from(video.options).map((o) => o.textContent?.trim())).toEqual(['No incluir', 'Crear videollamada']);
    expect(Array.from(signer.options).map((o) => o.textContent?.trim())).toEqual(['Administrador', 'Presidente', 'Secretario']);
    expect(h.el.textContent).not.toContain('respaldo estatutario');
    video.value = 'yes';
    video.dispatchEvent(new Event('change'));
    signer.value = 'secretario';
    signer.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(h.component.draft.includeJitsi()).toBe(true);
    expect(h.component.draft.signerRole()).toBe('secretario');
    expect(h.el.textContent).toContain('respaldo estatutario');
    h.http.verify();
  });

  it('la confirmación permite descargar la convocatoria de la junta creada', async () => {
    const h = await setup();
    h.component.successInfo.set({ meeting: created, waitRoomUrl: '', beaconUrl: null, password: null, failedUploads: [] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const download = h.component.downloadConvocatoria();
    const req = h.http.expectOne(`${API}/meetings/m9/convocatoria.docx`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    await download;
    expect(click).toHaveBeenCalled();
    h.http.verify();
  });

  describe('convocatoria en el paso 3', () => {
    const doc = {
      header: { community: 'Comunidad Sol 12', title: 'Convocatoria Junta General Ordinaria' },
      notice: 'Aviso.',
      issuedLine: 'en Madrid a 1 de enero de 2027',
      greeting: 'Sr./a. Propietario/a:',
      intro: 'Texto de la convocatoria.',
      agenda: [{ number: '01', text: 'Aprobación de cuentas' }],
      closing: 'Cierre.',
      signature: ['El administrador'],
      authorization: { enabled: true, text: 'Sr. Presidente' },
    };

    async function atStep3(): Promise<Harness> {
      const h = await setup();
      fillDetails(h);
      fillAgenda(h);
      h.component.step.set(3);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/meetings/convocatoria-preview`).flush(doc);
      await settle();
      h.fixture.detectChanges();
      return h;
    }

    it('redacta la convocatoria con los datos del borrador al llegar y la muestra editable', async () => {
      const h = await setup();
      fillDetails(h);
      fillAgenda(h);
      h.component.step.set(3);
      h.fixture.detectChanges();
      const req = h.http.expectOne(`${API}/estates/e1/meetings/convocatoria-preview`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toMatchObject({
        type: 'ordinaria',
        convokedBy: 'presidente',
        scheduledAt1: new Date('2027-01-15T18:00').toISOString(),
        scheduledAt2: new Date('2027-01-15T18:30').toISOString(),
        signerRole: 'administrador',
      });
      expect(req.request.body.agenda[0].title).toBe('Aprobación de cuentas');
      req.flush(doc);
      await settle();
      h.fixture.detectChanges();
      await h.fixture.whenStable();
      const intro = h.el.querySelector('textarea[aria-label="Texto de la convocatoria"]') as HTMLTextAreaElement;
      expect(intro.value).toBe('Texto de la convocatoria.');
      // redactada por el servidor y sin tocar: no cuenta como cambio de la gestora
      expect(h.component.draft.convocatoriaEdited()).toBe(false);
      h.http.verify();
    });

    it('sin editar no envía la convocatoria al crear (el servidor la redacta igual al pedirla)', async () => {
      const h = await atStep3();
      expect(h.component.draft.toPayload().convocatoria).toBeUndefined();
    });

    it('si la gestora la edita, se envía tal cual al crear la junta', async () => {
      const h = await atStep3();
      const intro = h.el.querySelector('textarea[aria-label="Texto de la convocatoria"]') as HTMLTextAreaElement;
      intro.value = 'Texto editado a mano.';
      intro.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      expect(h.component.draft.convocatoriaEdited()).toBe(true);
      expect(h.component.draft.toPayload().convocatoria).toMatchObject({ intro: 'Texto editado a mano.', closing: 'Cierre.' });
      h.http.verify();
    });

    it('avisa si cambian los datos de la junta después de editarla y permite volver a redactarla', async () => {
      const h = await atStep3();
      h.component.draft.convocatoria.set({ ...doc, intro: 'Editada' });
      h.component.draft.scheduledAt1.set('2027-02-01T18:00');
      h.component.draft.scheduledAt2.set('2027-02-01T18:30');
      h.fixture.detectChanges();
      expect(h.component.draft.convocatoriaStale()).toBe(true);
      expect(h.el.textContent).toContain('Volver a redactarla con los nuevos datos');
    });

    it('si el servidor no puede redactarla lo dice y deja seguir sin convocatoria editada', async () => {
      const h = await setup();
      fillDetails(h);
      fillAgenda(h);
      h.component.step.set(3);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/meetings/convocatoria-preview`).error(new ProgressEvent('error'), { status: 500 });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('No se pudo redactar la convocatoria');
      expect(h.component.draft.toPayload().convocatoria).toBeUndefined();
    });
  });

  describe('create', () => {
    async function ready(): Promise<Harness> {
      const h = await setup();
      fillDetails(h);
      fillAgenda(h);
      h.component.draft.signerRole.set('presidente');
      h.component.draft.attendees.set([{ email: 'lucia@demo.app', name: 'Lucía Fernández' }]);
      h.fixture.detectChanges(); // en uso real el render ocurre entre la edición y el clic en "Crear junta"
      return h;
    }

    it('sends the same payload contract as before, then shows the confirmation and emits created', async () => {
      const h = await ready();
      const createdSpy = vi.fn();
      h.component.created.subscribe(createdSpy);
      void h.component.submit();
      const req = h.http.expectOne(`${API}/estates/e1/meetings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toMatchObject({
        title: 'Junta de enero',
        type: 'ordinaria',
        convokedBy: 'presidente',
        signerRole: 'presidente',
        attendeeEmails: ['lucia@demo.app'],
        includeJitsi: false,
        scheduledAt1: new Date('2027-01-15T18:00').toISOString(),
        scheduledAt2: new Date('2027-01-15T18:30').toISOString(),
      });
      expect(req.request.body.agenda[0].title).toBe('Aprobación de cuentas');
      req.flush(created);
      await settle();
      h.fixture.detectChanges();
      expect(createdSpy).toHaveBeenCalledWith(created);
      expect(h.component.showSuccess()).toBe(true);
      expect(h.el.textContent).toContain('¡Junta creada correctamente!');
      expect(h.el.textContent).toContain('«Junta de enero»');
      // No afirma nada que no se pueda confirmar (p. ej. "convocatorias enviadas").
      expect(h.el.textContent).not.toMatch(/enviad/i);
      h.http.verify();
    });

    it('uploads attachments after creating, one request per file', async () => {
      const h = await ready();
      const a = new File(['a'], 'convocatoria.pdf', { type: 'application/pdf' });
      const b = new File(['b'], 'plano.png', { type: 'image/png' });
      h.component.draft.attachments.set([a, b]);
      void h.component.submit();
      h.http.expectOne(`${API}/estates/e1/meetings`).flush(created);
      await settle();
      const uploads = h.http.match(`${API}/meetings/m9/attachments`);
      expect(uploads.length).toBe(2);
      uploads.forEach((u) => u.flush({ id: 'x', title: 't', uploadedAt: '2027-01-01' }));
      await settle();
      expect(h.component.successInfo()?.failedUploads).toEqual([]);
    });

    it('does not hide attachments that failed to upload', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = await ready();
      h.component.draft.attachments.set([
        new File(['a'], 'bien.pdf', { type: 'application/pdf' }),
        new File(['b'], 'mal.pdf', { type: 'application/pdf' }),
      ]);
      void h.component.submit();
      h.http.expectOne(`${API}/estates/e1/meetings`).flush(created);
      await settle();
      const uploads = h.http.match(`${API}/meetings/m9/attachments`);
      uploads[0].flush({ id: 'x', title: 't', uploadedAt: '2027-01-01' });
      uploads[1].flush({ message: 'Tipo de fichero no permitido' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      h.fixture.detectChanges();
      expect(h.component.showSuccess()).toBe(true);
      expect(h.component.successInfo()?.failedUploads).toEqual(['mal.pdf']);
      expect(h.el.textContent).toContain('No se pudieron subir');
      expect(h.el.textContent).toContain('mal.pdf');
    });

    it('ignores a second submit while the first is in flight', async () => {
      const h = await ready();
      void h.component.submit();
      void h.component.submit();
      expect(h.component.draft.saving()).toBe(true);
      h.http.expectOne(`${API}/estates/e1/meetings`).flush(created); // expectOne falla si hubiera dos
      await settle();
      expect(h.component.draft.saving()).toBe(false);
    });

    it('shows the server validation message, stays open and lets the user retry', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = await ready();
      void h.component.submit();
      h.http
        .expectOne(`${API}/estates/e1/meetings`)
        .flush({ message: ['location must be shorter than or equal to 255 characters'] }, { status: 400, statusText: 'Bad Request' });
      await settle();
      h.fixture.detectChanges();
      expect(h.component.showSuccess()).toBe(false);
      expect(h.component.draft.saving()).toBe(false);
      expect(h.el.querySelector('#junta-wizard-error')?.textContent).toContain('location must be shorter');
      expect(h.el.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('falls back to a generic message for other failures', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = await ready();
      void h.component.submit();
      h.http.expectOne(`${API}/estates/e1/meetings`).error(new ProgressEvent('error'), { status: 0 });
      await settle();
      expect(h.component.draft.error()?.message).toBe('No se pudo crear la junta.');
      expect(h.component.draft.error()?.field).toBeNull();
    });

    it('jumps to the step that has the problem when submitting an invalid draft', async () => {
      const h = await setup();
      h.component.draft.setType('extraordinaria');
      fillDetails(h);
      h.component.step.set(3);
      void h.component.submit();
      h.http.expectNone(`${API}/estates/e1/meetings`);
      expect(h.component.step()).toBe(2);
      expect(h.component.draft.error()?.message).toBe('Todos los puntos deben tener título.');
    });

    it('"Ver junta" emits the created meeting and closes', async () => {
      const h = await ready();
      const viewed = vi.fn();
      const closed = vi.fn();
      h.component.viewed.subscribe(viewed);
      h.component.closed.subscribe(closed);
      void h.component.submit();
      h.http.expectOne(`${API}/estates/e1/meetings`).flush(created);
      await settle();
      h.component.viewMeeting();
      expect(viewed).toHaveBeenCalledWith(created);
      expect(closed).toHaveBeenCalled();
    });
  });

  describe('closing', () => {
    it('closes without asking when nothing was changed', async () => {
      const h = await setup();
      const confirmSpy = vi.spyOn(ConfirmDialogService.prototype, 'ask');
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      h.component.requestClose();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalled();
    });

    it('asks before discarding data and stays open if the user declines', async () => {
      const h = await setup();
      h.component.draft.title.set('Algo');
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      h.component.requestClose();
      expect(closed).not.toHaveBeenCalled();
      expect(h.component.open).toBe(true);
    });

    it('closes when the user confirms discarding', async () => {
      const h = await setup();
      h.component.draft.title.set('Algo');
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      await h.component.requestClose();
      expect(closed).toHaveBeenCalled();
      expect(h.component.open).toBe(false);
    });

    it('cannot be closed while saving', async () => {
      const h = await setup();
      h.component.draft.saving.set(true);
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      h.component.requestClose();
      expect(closed).not.toHaveBeenCalled();
    });

    it('Escape asks to close; Tab stays inside the dialog', async () => {
      const h = await setup();
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      const dialog = h.el.querySelector<HTMLElement>('[role="dialog"]')!;
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(closed).toHaveBeenCalled();
    });
  });

  it('starts from a clean draft every time it is reopened', async () => {
    const h = await setup();
    h.component.draft.title.set('Se debe borrar');
    h.fixture.componentRef.setInput('open', false);
    h.fixture.componentRef.setInput('open', true);
    h.http.expectOne(`${API}/estates/e1/properties/owner-emails`).flush([]);
    await settle();
    expect(h.component.draft.title()).toBe('');
    expect(h.component.step()).toBe(1);
  });

  it('keeps working when owners cannot be loaded (manual attendees only)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = setupComponent(CreateJuntaModalComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.componentRef.setInput('open', true);
    h.fixture.detectChanges();
    h.http
      .expectOne(`${API}/estates/e1/properties/owner-emails`)
      .flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(h.component.draft.attendees()).toEqual([]);
    expect(h.component.draft.loadingOwners()).toBe(false);
    expect(new HttpErrorResponse({ status: 500 }).status).toBe(500);
  });

  describe('edit mode', () => {
    const existing = {
      id: 'm1',
      estateId: 'e1',
      title: 'Junta de enero',
      type: 'ordinaria',
      status: 'convocada',
      convokedBy: 'presidente',
      scheduledAt1: new Date(2027, 0, 15, 18, 0).toISOString(),
      scheduledAt2: new Date(2027, 0, 15, 18, 30).toISOString(),
      location: 'Calle Mayor 1',
      signerRole: 'administrador',
      agenda: [{ id: 'a1', title: 'Aprobación de cuentas' }],
      includeJitsi: false,
    } as unknown as Meeting;

    async function setupEdit() {
      const h = setupComponent(CreateJuntaModalComponent, { user: makeUser() });
      h.fixture.componentRef.setInput('estateId', 'e1');
      h.fixture.componentRef.setInput('meeting', existing);
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      return h;
    }

    it('prefills the draft, skips the guests step and does not load owners', async () => {
      const h = await setupEdit();
      h.http.expectNone(`${API}/estates/e1/properties/owner-emails`);
      expect(h.component.draft.title()).toBe('Junta de enero');
      expect(h.el.querySelector('#junta-wizard-title')?.textContent).toContain('Editar junta');
      expect(h.el.querySelectorAll('.step-indicator .step-pill')).toHaveLength(2);
      h.component.next();
      expect(h.component.step()).toBe(2);
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Guardar cambios');
      expect(h.el.textContent).not.toContain('Crear junta');
      h.http.verify();
    });

    it('saves through PATCH, emits the updated meeting and closes', async () => {
      const h = await setupEdit();
      const saved = vi.fn();
      const closed = vi.fn();
      h.component.saved.subscribe(saved);
      h.component.closed.subscribe(closed);
      h.component.draft.title.set('Junta cambiada');
      h.component.next();
      const pending = h.component.submit();
      const request = h.http.expectOne(`${API}/meetings/m1`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body.title).toBe('Junta cambiada');
      expect(request.request.body).not.toHaveProperty('attendeeEmails');
      request.flush({ ...existing, title: 'Junta cambiada' });
      await pending;
      expect(saved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Junta cambiada' }));
      expect(closed).toHaveBeenCalled();
      h.http.verify();
    });

    it('shows the server message when the edit is rejected and keeps the modal open', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = await setupEdit();
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      h.component.next();
      const pending = h.component.submit();
      h.http
        .expectOne(`${API}/meetings/m1`)
        .flush({ message: 'No se puede modificar el orden del día: ya se han abierto votaciones en esta junta.' }, { status: 409, statusText: 'Conflict' });
      await pending;
      expect(h.component.draft.error()?.message).toContain('ya se han abierto votaciones');
      expect(closed).not.toHaveBeenCalled();
    });
  });
});
