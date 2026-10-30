import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { LinkedEntity } from '../../../core/agenda-tasks.model';
import { TaskFormDialogComponent, TaskPrefill } from './task-form-dialog.component';

type Harness = ComponentHarness<TaskFormDialogComponent>;

function open(prefill: TaskPrefill | null = null, defaultEstateId = ''): Harness {
  const h = setupComponent(TaskFormDialogComponent, { user: makeUser({ role: 'B', id: 'u1' }) });
  h.fixture.componentRef.setInput('prefill', prefill);
  h.fixture.componentRef.setInput('defaultEstateId', defaultEstateId);
  h.fixture.detectChanges();
  return h;
}

const CREATE_URL = `${API}/agenda/tasks`;

describe('TaskFormDialogComponent', () => {
  it('arranca con prioridad Media, tipo Otra, sin estado de "más opciones" y asignada a quien la crea', () => {
    const h = open();

    expect(h.component.priority()).toBe('MEDIA');
    expect(h.component.type()).toBe('OTRA');
    expect(h.component.status()).toBe('PENDIENTE');
    expect(h.component.assigneeId()).toBe('u1');
    expect(h.component.showMore()).toBe(false);
    expect(h.el.querySelector('#new-task-more')).toBeNull();
  });

  it('progressive disclosure: los campos secundarios solo aparecen con "Más opciones"', () => {
    const h = open();
    expect(h.el.textContent).not.toContain('Checklist');

    h.component.showMore.set(true);
    h.fixture.detectChanges();

    for (const label of ['Estado', 'Descripción', 'Etiquetas', 'Recordatorio', 'Repetición', 'Checklist', 'Entidades vinculadas', 'Adjuntos']) {
      expect(h.el.textContent).toContain(label);
    }
  });

  it('crear desde un hueco del calendario preselecciona día y hora', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 10 * 60 });
    await settle(); // ngModel escribe el valor en la vista un tick después
    h.fixture.detectChanges();

    expect(h.component.date()).toBe('2026-10-15');
    expect(h.component.time()).toBe('10:00');
    // Los mismos campos que las convocatorias de las juntas: calendario para el día y hh:mm para la hora.
    const fields = h.el.querySelectorAll('app-datetime-field');
    expect(fields.length).toBe(2);
    expect(fields[0].querySelector('.dtf__value')?.textContent?.trim()).toBe('15/10/2026');
    expect((fields[0].querySelector('.dtf__input') as HTMLInputElement).value).toBe('10:00');
  });

  it('usa la comunidad del filtro activo como valor inicial', () => {
    const h = open(null, 'e1');

    expect(h.component.estateId()).toBe('e1');
  });

  it('sin título no envía nada y marca el campo', async () => {
    const h = open();

    await h.component.submit();
    h.fixture.detectChanges();

    h.http.expectNone(CREATE_URL);
    expect(h.el.textContent).toContain('El título es obligatorio.');
    expect(h.component.error()).toBeTruthy();
  });

  it('envía los valores por defecto y la zona horaria del navegador', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 10 * 60 });
    h.component.title.set('  Llamar al proveedor  ');
    h.component.estateId.set('e1');
    h.component.type.set('LLAMADA');
    h.component.priority.set('URGENTE');
    h.component.endTime.set('11:30');

    const done = h.component.submit();
    await settle();
    const req = h.http.expectOne(CREATE_URL);
    req.flush({ id: 't1' });
    await done;

    const body = req.request.body;
    const start = new Date(2026, 9, 15, 10, 0);
    expect(body).toMatchObject({
      title: 'Llamar al proveedor',
      estateId: 'e1',
      assignedToUserId: 'u1',
      type: 'LLAMADA',
      priority: 'URGENTE',
      status: 'PENDIENTE',
      allDay: false,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 90 * 60_000).toISOString(),
    });
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(body.description).toBeUndefined();
    expect(body.recurrence).toBeUndefined();
    expect(body.reminderMinutesBefore).toBeUndefined();
  });

  it('una tarea "sin hora" se guarda como día completo (medianoches UTC, fin exclusivo)', async () => {
    const h = open({ date: new Date(2026, 9, 15) });
    h.component.title.set('Revisar contrato de mantenimiento');
    h.component.allDay.set(true);
    h.fixture.detectChanges();
    expect(h.el.querySelector('.dtf__input')).toBeNull();

    const done = h.component.submit();
    await settle();
    const req = h.http.expectOne(CREATE_URL);
    req.flush({ id: 't1' });
    await done;

    expect(req.request.body).toMatchObject({
      allDay: true,
      startAt: '2026-10-15T00:00:00.000Z',
      endAt: '2026-10-16T00:00:00.000Z',
    });
  });

  it('incluye recordatorio, repetición, etiquetas, checklist y vínculos cuando se rellenan', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 9 * 60 });
    h.component.title.set('Revisión mensual de morosidad');
    h.component.reminder.set(60);
    h.component.recurrence.set({ freq: 'MONTHLY', interval: 1, until: null });
    h.component.labelIds.set(['l1']);
    h.component.checklistDraft.set('Sacar listado');
    h.component.addChecklistItem();
    const link: LinkedEntity = { type: 'issue', id: 'i1', label: 'INC-1 · Fuga', estateId: 'e1', route: '/b/estates/e1?tab=issues&entity=i1' };
    h.component.addLink(link);

    const done = h.component.submit();
    await settle();
    const req = h.http.expectOne(CREATE_URL);
    req.flush({ id: 't1' });
    await done;

    expect(req.request.body).toMatchObject({
      reminderMinutesBefore: 60,
      recurrence: { freq: 'MONTHLY', interval: 1, until: null },
      labelIds: ['l1'],
      checklist: ['Sacar listado'],
      links: [{ type: 'issue', id: 'i1' }],
      // Sin comunidad elegida, la tarea hereda la de la entidad vinculada.
      estateId: 'e1',
    });
  });

  it('al vincular una entidad sin comunidad elegida, la tarea hereda la de la entidad', () => {
    const h = open();

    h.component.addLink({ type: 'supplier', id: 's1', label: 'Ascensores SA', estateId: 'e9', route: '' });

    expect(h.component.estateId()).toBe('e9');
  });

  it('cambiar de comunidad descarta los vínculos de la anterior', () => {
    const h = open();
    h.component.addLink({ type: 'supplier', id: 's1', label: 'A', estateId: 'e1', route: '' });
    h.component.addLink({ type: 'issue', id: 'i1', label: 'B', estateId: 'e1', route: '' });

    h.component.onEstateChange('e2');

    expect(h.component.links()).toEqual([]);
  });

  it('un vínculo repetido no se añade dos veces', () => {
    const h = open();
    const link: LinkedEntity = { type: 'supplier', id: 's1', label: 'A', estateId: 'e1', route: '' };

    h.component.addLink(link);
    h.component.addLink(link);

    expect(h.component.links()).toHaveLength(1);
  });

  it('sube los adjuntos tras crear la tarea y avisa si alguno falla', async () => {
    const h = open();
    h.component.title.set('Con adjuntos');
    h.component.files.set([new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]);
    let result: unknown;
    h.component.created.subscribe((r) => (result = r));

    const done = h.component.submit();
    await settle();
    h.http.expectOne(CREATE_URL).flush({ id: 't1' });
    await settle();
    h.http.expectOne(`${CREATE_URL}/t1/attachments`).flush({});
    await settle();
    h.http.expectOne(`${CREATE_URL}/t1/attachments`).flush('no', { status: 400, statusText: 'Bad Request' });
    await done;

    expect(result).toMatchObject({ failedUploads: 1 });
  });

  it('si el servidor falla, muestra el error y deja reintentar', async () => {
    const h = open();
    h.component.title.set('Tarea');

    const done = h.component.submit();
    await settle();
    h.http.expectOne(CREATE_URL).flush('no', { status: 500, statusText: 'Server Error' });
    await done;
    h.fixture.detectChanges();

    expect(h.component.error()).toContain('No se pudo crear la tarea');
    expect(h.component.saving()).toBe(false);
  });

  it('Escape cierra el diálogo', () => {
    const h = open();
    let closed = false;
    h.component.closed.subscribe(() => (closed = true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closed).toBe(true);
  });

  it('un doble envío (doble clic, o Intro + clic) NO crea dos tareas', async () => {
    const h = open();
    h.component.title.set('Solo una vez');

    const first = h.component.submit();
    const second = h.component.submit();
    await settle();
    const requests = h.http.match((r) => r.method === 'POST' && r.url === CREATE_URL);
    expect(requests).toHaveLength(1);
    requests[0].flush({ id: 't1' });
    await Promise.all([first, second]);
  });


  it('es un diálogo modal accesible: role, aria-modal, nombre y encabezado', () => {
    const h = open();

    const dialog = h.el.querySelector('.modal');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby') ?? '';
    expect(h.el.querySelector(`#${labelledBy}`)?.tagName).toBe('H2');
    expect(h.el.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
  });

  it('el foco entra en el título al abrirse', async () => {
    const h = open();
    await settle();
    expect(document.activeElement?.getAttribute('name')).toBe('title');
  });

  it('empieza con el fin una hora después del inicio y mover el inicio mueve el fin', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 10 * 60 });
    await settle();
    h.fixture.detectChanges();

    expect(h.component.endDate()).toBe('2026-10-15');
    expect(h.component.endTime()).toBe('11:00');
    const end = h.el.querySelectorAll('app-datetime-field')[1];
    expect(end.querySelector('.dtf__value')?.textContent?.trim()).toBe('15/10/2026');
    expect((end.querySelector('.dtf__input') as HTMLInputElement).value).toBe('11:00');

    h.component.onStartChange({ date: '2026-10-17', time: '23:30' });
    expect(h.component.endDate()).toBe('2026-10-18');
    expect(h.component.endTime()).toBe('00:30');
  });

  it('una tarea que acaba otro día se envía con su fecha y hora de fin', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 18 * 60 });
    h.component.title.set('Obra en la fachada');
    h.component.endDate.set('2026-10-17');
    h.component.endTime.set('09:00');

    const done = h.component.submit();
    await settle();
    const req = h.http.expectOne(CREATE_URL);
    req.flush({ id: 't1' });
    await done;

    expect(req.request.body).toMatchObject({
      allDay: false,
      startAt: new Date(2026, 9, 15, 18, 0).toISOString(),
      endAt: new Date(2026, 9, 17, 9, 0).toISOString(),
    });
  });

  it('un fin anterior al inicio no se envía y se explica', async () => {
    const h = open({ date: new Date(2026, 9, 15), minutes: 10 * 60 });
    h.component.title.set('Revisión');
    h.component.endDate.set('2026-10-14');

    await h.component.submit();
    h.fixture.detectChanges();

    h.http.expectNone(CREATE_URL);
    expect(h.el.querySelector('[data-schedule-error]')?.textContent).toContain('anteriores');
  });

  it('«Sin hora concreta» en varios días guarda el último día como fin exclusivo', async () => {
    const h = open({ date: new Date(2026, 9, 15) });
    h.component.title.set('Cierre de la piscina');
    h.component.onAllDayChange(true);
    h.component.endDate.set('2026-10-17');
    h.fixture.detectChanges();
    expect(h.el.querySelector('.dtf__input')).toBeNull();

    const done = h.component.submit();
    await settle();
    const req = h.http.expectOne(CREATE_URL);
    req.flush({ id: 't1' });
    await done;

    expect(req.request.body).toMatchObject({ allDay: true, startAt: '2026-10-15T00:00:00.000Z', endAt: '2026-10-18T00:00:00.000Z' });
  });
});
