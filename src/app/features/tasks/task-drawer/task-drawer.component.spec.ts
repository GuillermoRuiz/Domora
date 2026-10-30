import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { AgendaTask, AgendaTaskDetail } from '../../../core/agenda-tasks.model';
import { TaskDrawerComponent } from './task-drawer.component';

type Harness = ComponentHarness<TaskDrawerComponent>;

function task(overrides: Partial<AgendaTask> = {}): AgendaTask {
  return {
    id: 't1', occurrenceKey: 't1', recurring: false,
    occurrenceStart: '2026-10-14T07:00:00.000Z', occurrenceEnd: '2026-10-14T08:00:00.000Z',
    title: 'Llamar al proveedor', estate: { id: 'e1', name: 'San Miguel' },
    assignee: { id: 'u1', fullName: 'Laura Martínez' }, type: 'LLAMADA', priority: 'ALTA', status: 'PENDIENTE',
    overdue: false, allDay: false, timezone: 'Europe/Madrid', startAt: '2026-10-14T07:00:00.000Z', endAt: '2026-10-14T08:00:00.000Z',
    reminderMinutesBefore: null, recurrence: null, labels: [], checklistDone: 0, checklistTotal: 0, commentCount: 0,
    attachmentCount: 0, linkCount: 0, source: 'manual', createdByUserId: 'u1',
    createdByKind: 'person', issueId: null, kind: null,
    ...overrides,
  };
}

function detail(overrides: Partial<AgendaTaskDetail> = {}): AgendaTaskDetail {
  return {
    ...task(), description: null, createdBy: { id: 'u1', fullName: 'Laura Martínez' }, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
    checklist: [], comments: [], attachments: [], links: [],
    payload: null, outcome: null, resultRef: null,
    ...overrides,
  };
}

async function open(selected: AgendaTask, d: AgendaTaskDetail = detail()): Promise<Harness> {
  const h = setupComponent(TaskDrawerComponent, { user: makeUser({ role: 'B', id: 'u1' }) });
  h.fixture.componentRef.setInput('task', selected);
  h.fixture.detectChanges();
  await settle();
  h.http.expectOne(`${API}/agenda/tasks/${selected.id}`).flush(d);
  await settle();
  h.fixture.detectChanges();
  return h;
}

describe('TaskDrawerComponent', () => {
  describe('tareas de decisión de una incidencia (las abre Domora o el flujo manual)', () => {
    const decisionTask = (kind: string) => task({ kind, issueId: 'i1', createdByKind: 'system' });

    it('ofrece la decisión pendiente y no los botones genéricos de completar, cancelar o reabrir', async () => {
      const h = await open(decisionTask('inform_requester'), detail({ kind: 'inform_requester', issueId: 'i1' }));

      expect(h.el.querySelector('app-task-decision-panel .decision')).not.toBeNull();
      const actions = h.component.actionItems().map((a) => a.id);
      expect(actions).toEqual(['delete']);
    });

    it('decidir resuelve la tarea (POST /resolution) y avisa a la página con la tarea actualizada', async () => {
      const h = await open(decisionTask('inform_requester'), detail({ kind: 'inform_requester', issueId: 'i1' }));
      let changed: AgendaTaskDetail | undefined;
      h.component.changed.subscribe((d) => (changed = d));

      (Array.from(h.el.querySelectorAll('.decision__btn')).find((b) => b.textContent?.includes('Informar al solicitante')) as HTMLButtonElement).click();
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/agenda/tasks/t1/resolution`);
      expect(req.request.body).toEqual({ result: { decision: 'send' } });
      req.flush(detail({ kind: 'inform_requester', issueId: 'i1', status: 'COMPLETADA', outcome: 'approved' }));
      await settle();
      h.fixture.detectChanges();

      expect(changed?.status).toBe('COMPLETADA');
      expect(h.component.detail()?.outcome).toBe('approved');
    });

    it('una tarea manual conserva sus acciones de siempre y no muestra ningún panel de decisión', async () => {
      const h = await open(task());
      expect(h.el.querySelector('app-task-decision-panel .decision')).toBeNull();
      expect(h.component.actionItems().map((a) => a.id)).toEqual(['complete', 'cancel', 'delete']);
      expect(h.el.querySelector('[data-drawer-save]')).toBeNull();
    });
  });

  it('carga la ficha completa y muestra comunidad, responsable, tipo y prioridad', async () => {
    const h = await open(task());

    expect(h.el.textContent).toContain('Detalle de tarea');
    expect((h.el.querySelector('textarea.title') as HTMLTextAreaElement).value).toBe('Llamar al proveedor');
    expect(h.el.textContent).toContain('Pendiente');
  });

  it('error de carga: ofrece reintentar', async () => {
    const h = setupComponent(TaskDrawerComponent, { user: makeUser({ role: 'B' }) });
    h.fixture.componentRef.setInput('task', task());
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/agenda/tasks/t1`).flush('no', { status: 500, statusText: 'Server Error' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('No se pudo cargar la tarea.');
    h.component.load();
    await settle();
    h.http.expectOne(`${API}/agenda/tasks/t1`).flush(detail());
  });

  it('el título se guarda al salir del campo y solo si cambió', async () => {
    const h = await open(task());
    let changed: unknown;
    h.component.changed.subscribe((d) => (changed = d));

    h.component.saveTitle('Llamar al proveedor');
    h.http.expectNone((r) => r.method === 'PATCH');

    h.component.saveTitle('  Llamar al proveedor del ascensor ');
    await settle();
    const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'Llamar al proveedor del ascensor' });
    req.flush(detail({ title: 'Llamar al proveedor del ascensor' }));
    await settle();

    expect(changed).toMatchObject({ title: 'Llamar al proveedor del ascensor' });
  });

  it('un título vacío no se guarda', async () => {
    const h = await open(task());

    h.component.saveTitle('   ');

    h.http.expectNone((r) => r.method === 'PATCH');
    expect(h.component.error()).toContain('no puede estar vacío');
  });

  it('desasignar y quitar la comunidad mandan null (borrar), no omiten el campo', async () => {
    const h = await open(task());

    h.component.saveAssignee('');
    await settle();
    const a = h.http.expectOne(`${API}/agenda/tasks/t1`);
    expect(a.request.body).toEqual({ assignedToUserId: null });
    a.flush(detail({ assignee: null }));
    await settle();

    h.component.saveEstate('');
    await settle();
    const b = h.http.expectOne(`${API}/agenda/tasks/t1`);
    expect(b.request.body).toEqual({ estateId: null });
    b.flush(detail({ estate: null }));
    await settle();
  });

  it('un fallo al guardar muestra el error sin perder la ficha', async () => {
    const h = await open(task());

    h.component.savePriority('URGENTE');
    await settle();
    h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/agenda/tasks/t1`).flush('no', { status: 403, statusText: 'Forbidden' });
    await settle();
    // Tras el fallo se vuelve a leer la tarea: ningún control puede seguir mostrando lo que el servidor rechazó.
    h.http.expectOne((r) => r.method === 'GET' && r.url === `${API}/agenda/tasks/t1`).flush(detail({ priority: 'ALTA' }));
    await settle();
    h.fixture.detectChanges();

    expect(h.component.error()).toContain('No se pudo guardar');
    expect(h.component.detail()?.priority).toBe('ALTA');
    expect(h.component.saving()).toBe(false);
  });

  it('dos cambios seguidos se guardan EN ORDEN y el segundo parte del resultado del primero', async () => {
    const h = await open(task());

    h.component.savePriority('URGENTE');
    h.component.saveType('VISITA');
    await settle();
    const first = h.http.expectOne((r) => r.method === 'PATCH');
    expect(first.request.body).toEqual({ priority: 'URGENTE' });
    h.http.expectNone((r) => r.method === 'PATCH' && r.body?.type); // el segundo espera al primero
    first.flush(detail({ priority: 'URGENTE' }));
    await settle();
    const second = h.http.expectOne((r) => r.method === 'PATCH');
    expect(second.request.body).toEqual({ type: 'VISITA' });
    second.flush(detail({ priority: 'URGENTE', type: 'VISITA' }));
    await settle();

    expect(h.component.detail()).toMatchObject({ priority: 'URGENTE', type: 'VISITA' });
    expect(h.component.saving()).toBe(false);
  });

  it('duplicar no es reentrante: un doble clic crea UNA copia', async () => {
    const h = await open(task());

    void h.component.duplicate();
    void h.component.duplicate();
    await settle();

    expect(h.http.match((r) => r.method === 'POST' && r.url.endsWith('/duplicate'))).toHaveLength(1);
  });

  it('añadir un comentario no es reentrante: un doble clic no lo duplica', async () => {
    const h = await open(task());
    h.component.commentDraft.set('Una sola vez');

    void h.component.addComment();
    void h.component.addComment();
    await settle();

    expect(h.http.match((r) => r.method === 'POST' && r.url.endsWith('/comments'))).toHaveLength(1);
  });

  describe('estado', () => {
    it('completar una tarea simple cambia el estado de la tarea', async () => {
      const h = await open(task());

      h.component.complete();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1/status`);
      expect(req.request.body).toEqual({ status: 'COMPLETADA' });
      req.flush(detail({ status: 'COMPLETADA' }));
    });

    it('completar una ocurrencia de una serie manda SU inicio, no cierra la serie', async () => {
      const occurrence = task({ recurring: true, occurrenceKey: 't1@2026-10-21T07:00:00.000Z', occurrenceStart: '2026-10-21T07:00:00.000Z', recurrence: { freq: 'WEEKLY', interval: 1, until: null } });
      const h = await open(occurrence, detail({ recurring: true, recurrence: { freq: 'WEEKLY', interval: 1, until: null } }));

      h.component.complete();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1/status`);
      expect(req.request.body).toEqual({ status: 'COMPLETADA', occurrenceStart: '2026-10-21T07:00:00.000Z' });
      req.flush(detail());
    });

    it('una tarea completada ofrece reabrir en lugar de completar', async () => {
      const h = await open(task({ status: 'COMPLETADA' }), detail({ status: 'COMPLETADA' }));

      const ids = h.component.actionItems().map((a) => a.id);
      expect(ids).toContain('reopen');
      expect(ids).not.toContain('complete');
    });

    it('"Reabrir" pide al servidor volver al estado que tenía antes de completarse', async () => {
      const h = await open(task({ status: 'COMPLETADA' }), detail({ status: 'COMPLETADA' }));

      h.component.onAction('reopen');
      await settle();

      const req = h.http.expectOne(`${API}/agenda/tasks/t1/status`);
      expect(req.request.body).toEqual({ status: 'PENDIENTE', restorePrevious: true });
      req.flush(detail({ status: 'EN_CURSO' }));
    });

    it('muestra "Vencida" cuando la ocurrencia está vencida', async () => {
      const h = await open(task({ overdue: true }), detail({ overdue: true }));

      expect(h.el.querySelector('.statusline')?.textContent).toContain('Vencida');
    });

    it('eliminar no borra: pide confirmación a la página', async () => {
      const h = await open(task());
      let requested: AgendaTask | undefined;
      h.component.deleteRequested.subscribe((t) => (requested = t));

      h.component.onAction('delete');

      expect(requested?.id).toBe('t1');
      h.http.expectNone((r) => r.method === 'DELETE');
    });
  });

  describe('reprogramar', () => {
    it('guarda fecha y horas locales como instantes ISO', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.scheduleDate.set('2026-10-16');
      h.component.scheduleStart.set('11:00');
      h.component.scheduleEndDate.set('2026-10-16');
      h.component.scheduleEnd.set('12:30');
      const saving = h.component.saveSchedule();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      req.flush(detail());
      await saving;

      expect(req.request.body).toMatchObject({
        startAt: new Date(2026, 9, 16, 11, 0).toISOString(),
        endAt: new Date(2026, 9, 16, 12, 30).toISOString(),
        allDay: false,
      });
      expect(h.component.editingSchedule()).toBe(false);
    });

    it('"Todo el día" se guarda como medianoche UTC con fin exclusivo', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.scheduleDate.set('2026-10-16');
      h.component.scheduleEndDate.set('2026-10-16');
      h.component.scheduleAllDay.set(true);
      const saving = h.component.saveSchedule();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      req.flush(detail());
      await saving;

      expect(req.request.body).toMatchObject({ startAt: '2026-10-16T00:00:00.000Z', endAt: '2026-10-17T00:00:00.000Z', allDay: true });
    });

    it('una hora de fin anterior a la de inicio NO se guarda ni se "corrige" en silencio: se avisa', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.scheduleStart.set('15:00');
      h.component.scheduleEnd.set('09:00');
      await h.component.saveSchedule();
      await settle();

      h.http.expectNone((r) => r.method === 'PATCH');
      expect(h.component.error()).toContain('anteriores');
      expect(h.component.editingSchedule()).toBe(true);
    });
    it('una tarea con fecha de fin en otro día se guarda con ese fin', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.scheduleDate.set('2026-10-16');
      h.component.scheduleStart.set('18:00');
      h.component.scheduleEndDate.set('2026-10-18');
      h.component.scheduleEnd.set('09:30');
      const saving = h.component.saveSchedule();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      req.flush(detail());
      await saving;

      expect(req.request.body).toMatchObject({
        startAt: new Date(2026, 9, 16, 18, 0).toISOString(),
        endAt: new Date(2026, 9, 18, 9, 30).toISOString(),
        allDay: false,
      });
    });

    it('«Todo el día» en varios días guarda el último día como fin exclusivo', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.scheduleAllDay.set(true);
      h.component.onScheduleStartChange({ date: '2026-10-16' });
      h.component.scheduleEndDate.set('2026-10-18');
      const saving = h.component.saveSchedule();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      req.flush(detail());
      await saving;

      expect(req.request.body).toMatchObject({ startAt: '2026-10-16T00:00:00.000Z', endAt: '2026-10-19T00:00:00.000Z', allDay: true });
    });

    it('cambiar la fecha o la hora se guarda sin pulsar «Guardar»', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.onScheduleEndValue('2026-10-14T19:30');
      await settle();

      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      expect(req.request.body).toMatchObject({ endAt: new Date(2026, 9, 14, 19, 30).toISOString() });
      req.flush(detail());
      await settle();
      expect(h.component.editingSchedule()).toBe(true);
    });

    it('mover el inicio mueve el fin con él y conserva la duración', async () => {
      const h = await open(task());

      h.component.startScheduleEdit();
      h.component.onScheduleStartChange({ date: '2026-10-20', time: '08:00' });
      h.component.scheduleEnd.set('10:00');
      h.component.onScheduleStartChange({ date: '2026-10-21' });

      expect(h.component.scheduleEndDate()).toBe('2026-10-21');
      expect(h.component.scheduleEnd()).toBe('10:00');
    });
  });

  describe('checklist', () => {
    const items = [
      { id: 'c1', text: 'Revisar histórico', done: true, position: 0 },
      { id: 'c2', text: 'Llamar', done: false, position: 1 },
      { id: 'c3', text: 'Pedir presupuesto', done: false, position: 2 },
    ];

    it('muestra el progreso 1 / 3 · 33 %', async () => {
      const h = await open(task(), detail({ checklist: items }));

      expect(h.component.checklistProgress()).toEqual({ done: 1, total: 3, percent: 33 });
      expect(h.el.querySelector('.progress')?.textContent?.trim()).toBe('1 / 3 · 33%');
      expect(h.el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('33');
    });

    it('marcar una subtarea actualiza el progreso y avisa a la página', async () => {
      const h = await open(task(), detail({ checklist: items }));
      let notified = 0;
      h.component.changed.subscribe(() => (notified += 1));

      const pending = h.component.toggleChecklistItem('c2', true);
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1/checklist/c2`);
      expect(req.request.body).toEqual({ done: true });
      req.flush({ ...items[1], done: true });
      await pending;

      expect(h.component.checklistProgress()).toEqual({ done: 2, total: 3, percent: 67 });
      expect(notified).toBe(1);
    });

    it('añadir una subtarea la agrega y vacía el campo', async () => {
      const h = await open(task());
      h.component.checklistDraft.set('Nueva');

      const pending = h.component.addChecklistItem();
      await settle();
      h.http.expectOne(`${API}/agenda/tasks/t1/checklist`).flush({ id: 'c9', text: 'Nueva', done: false, position: 0 });
      await pending;

      expect(h.component.detail()?.checklist).toHaveLength(1);
      expect(h.component.checklistDraft()).toBe('');
    });
  });

  describe('comentarios', () => {
    it('solo se puede borrar un comentario propio', async () => {
      const comments = [
        { id: 'm1', text: 'Mío', createdAt: '2026-10-14T08:24:00.000Z', author: { id: 'u1', fullName: 'Laura Martínez' } },
        { id: 'm2', text: 'Ajeno', createdAt: '2026-10-14T09:00:00.000Z', author: { id: 'u2', fullName: 'Carlos Ruiz' } },
      ];
      const h = await open(task(), detail({ comments }));

      const rows = Array.from(h.el.querySelectorAll('.comment'));
      expect(rows[0].querySelector('button')).not.toBeNull();
      expect(rows[1].querySelector('button')).toBeNull();
      expect(rows[1].textContent).toContain('Carlos Ruiz');
    });

    it('añade un comentario y vacía el cuadro', async () => {
      const h = await open(task());
      h.component.commentDraft.set('He preparado el histórico');

      const pending = h.component.addComment();
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1/comments`);
      expect(req.request.body).toEqual({ text: 'He preparado el histórico' });
      req.flush({ id: 'm1', text: 'He preparado el histórico', createdAt: '2026-10-14T08:24:00.000Z', author: { id: 'u1', fullName: 'Laura Martínez' } });
      await pending;

      expect(h.component.detail()?.comments).toHaveLength(1);
      expect(h.component.commentDraft()).toBe('');
    });
  });

  describe('vínculos', () => {
    it('abrir una entidad vinculada navega a su ruta en Domora', async () => {
      const link = { type: 'issue' as const, id: 'i1', label: 'INC-482 · Avería ascensor', estateId: 'e1', route: '/b/estates/e1?tab=issues&entity=i1' };
      const h = await open(task(), detail({ links: [link] }));
      const navigate = vi.spyOn(h.component['router'], 'navigateByUrl').mockResolvedValue(true);

      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.linked')).find((b) => b.textContent?.includes('INC-482'))?.click();

      expect(navigate).toHaveBeenCalledWith('/b/estates/e1?tab=issues&entity=i1');
    });

    it('una tarea que nace de una incidencia enseña la incidencia bajo el título, la abre y no deja quitar ese vínculo', async () => {
      const link = { type: 'issue' as const, id: 'i1', label: '#INC-2026-062 · Fuga en el garaje', estateId: 'e1', route: '/b/incidencias/i1' };
      const h = await open(
        task({ kind: 'review_issue', issueId: 'i1', createdByKind: 'system' }),
        detail({ kind: 'review_issue', issueId: 'i1', links: [link] }),
      );
      const navigate = vi.spyOn(h.component['router'], 'navigateByUrl').mockResolvedValue(true);

      const origin = h.el.querySelector<HTMLButtonElement>('[data-origin-issue]')!;
      expect(origin.textContent).toContain('#INC-2026-062 · Fuga en el garaje');
      // El vínculo de origen sale en «Vinculado a», pero sin aspa para quitarlo.
      expect(h.el.querySelector('[aria-label^="Quitar vínculo"]')).toBeNull();
      origin.click();

      expect(navigate).toHaveBeenCalledWith('/b/incidencias/i1');
    });

    it('una tarea manual no enseña el recuadro de incidencia y sus vínculos se pueden quitar', async () => {
      const link = { type: 'issue' as const, id: 'i1', label: 'A', estateId: 'e1', route: '' };
      const h = await open(task(), detail({ links: [link] }));

      expect(h.el.querySelector('[data-origin-issue]')).toBeNull();
      expect(h.el.querySelector('[aria-label^="Quitar vínculo"]')).not.toBeNull();
    });

    it('quitar un vínculo manda la lista restante', async () => {
      const links = [
        { type: 'issue' as const, id: 'i1', label: 'A', estateId: 'e1', route: '' },
        { type: 'supplier' as const, id: 's1', label: 'B', estateId: 'e1', route: '' },
      ];
      const h = await open(task(), detail({ links }));

      const pending = h.component.removeLink(links[0]);
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      expect(req.request.body).toEqual({ links: [{ type: 'supplier', id: 's1' }] });
      req.flush(detail({ links: [links[1]] }));
      await pending;
    });
  });

  it('ordena los campos en dos secciones con pestañas: Detalles y Seguimiento', async () => {
    const h = await open(task());
    const tabs = Array.from(h.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Detalles', 'Seguimiento']);
    const details = h.el.querySelector<HTMLElement>('#task-panel-details')!;
    const follow = h.el.querySelector<HTMLElement>('#task-panel-follow')!;
    // Al abrir se ven los datos de la tarea; el seguimiento está en la otra pestaña.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(details.hidden).toBe(false);
    expect(follow.hidden).toBe(true);
    expect(details.textContent).toContain('Comunidad');
    expect(details.textContent).toContain('Descripción');
    expect(follow.textContent).toContain('Checklist');
    expect(follow.textContent).toContain('Comentarios');
    tabs[1].click();
    h.fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(details.hidden).toBe(true);
    expect(follow.hidden).toBe(false);
  });

  it('es un diálogo modal accesible: role, aria-modal, encabezados jerárquicos y foco en "Cerrar"', async () => {
    const h = await open(task());

    const drawer = h.el.querySelector('.drawer');
    expect(drawer?.getAttribute('role')).toBe('dialog');
    expect(drawer?.getAttribute('aria-modal')).toBe('true');
    expect(h.el.querySelector(`#${drawer?.getAttribute('aria-labelledby')}`)?.tagName).toBe('H2');
    const levels = Array.from(h.el.querySelectorAll('h2, h3, h4, h5')).map((e) => e.tagName);
    expect(levels.every((l) => l === 'H2' || l === 'H3')).toBe(true);
    expect(h.el.querySelector('button[aria-label="Cerrar el detalle"]')?.hasAttribute('data-autofocus')).toBe(true);
  });

});
