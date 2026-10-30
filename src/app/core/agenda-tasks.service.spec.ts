import { API, setupApiService } from './testing/data-service-harness';
import { AgendaTasksService } from './agenda-tasks.service';

describe('AgendaTasksService', () => {
  it('list: manda el rango y los filtros como query params (listas separadas por comas)', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const promise = service.list({
      from: '2026-10-11T22:00:00.000Z',
      to: '2026-10-18T22:00:00.000Z',
      estateId: 'e1',
      assignee: 'me',
      status: ['PENDIENTE', 'EN_CURSO'],
      priority: ['URGENTE'],
      type: ['LLAMADA', 'VISITA'],
      labelIds: ['l1', 'l2'],
      q: '  ascensor ',
    });

    const req = http.expectOne((r) => r.url === `${API}/agenda/tasks`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('from')).toBe('2026-10-11T22:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-10-18T22:00:00.000Z');
    expect(req.request.params.get('estateId')).toBe('e1');
    expect(req.request.params.get('assignee')).toBe('me');
    expect(req.request.params.get('status')).toBe('PENDIENTE,EN_CURSO');
    expect(req.request.params.get('priority')).toBe('URGENTE');
    expect(req.request.params.get('type')).toBe('LLAMADA,VISITA');
    expect(req.request.params.get('labelIds')).toBe('l1,l2');
    expect(req.request.params.get('q')).toBe('ascensor');
    req.flush([]);
    await promise;
  });

  it('list: omite los filtros vacíos', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const promise = service.list({ estateId: '', assignee: '', status: [], labelIds: [], q: '   ' });

    const req = http.expectOne((r) => r.url === `${API}/agenda/tasks`);
    expect(req.request.params.keys().sort()).toEqual(['tz']);
    req.flush([]);
    await promise;
  });

  it('list manda la zona horaria del navegador (las tareas de día completo son fechas de calendario)', async () => {
    const { service, http } = setupApiService(AgendaTasksService);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const list = service.list({ from: 'a', to: 'b' });
    const listReq = http.expectOne((r) => r.url === `${API}/agenda/tasks`);
    expect(listReq.request.params.get('tz')).toBe(zone);
    listReq.flush([]);
    await list;
  });

  it('list: expone el aviso de truncado del servidor sin cambiar el cuerpo', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const truncated = service.list({ from: 'a', to: 'b' });
    http.expectOne((r) => r.url === `${API}/agenda/tasks`).flush([], { headers: { 'X-Agenda-Truncated': 'true' } });
    expect(await truncated).toEqual({ items: [], truncated: true });

    const complete = service.list({ from: 'a', to: 'b' });
    http.expectOne((r) => r.url === `${API}/agenda/tasks`).flush([]);
    expect(await complete).toEqual({ items: [], truncated: false });
  });

  it('create / update / remove usan los verbos y rutas esperados', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const created = service.create({ title: 'Revisar contrato', startAt: 's', endAt: 'e' });
    const post = http.expectOne(`${API}/agenda/tasks`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ title: 'Revisar contrato', startAt: 's', endAt: 'e' });
    post.flush({ id: 't1' });
    await created;

    const updated = service.update('t1', { assignedToUserId: null });
    const patch = http.expectOne(`${API}/agenda/tasks/t1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ assignedToUserId: null });
    patch.flush({ id: 't1' });
    await updated;

    const removed = service.remove('t1');
    const del = http.expectOne(`${API}/agenda/tasks/t1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await removed;
  });

  it('setStatus: en una serie manda la ocurrencia; en una tarea simple no', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const series = service.setStatus('t1', 'COMPLETADA', '2026-10-21T09:00:00.000Z');
    const a = http.expectOne(`${API}/agenda/tasks/t1/status`);
    expect(a.request.method).toBe('PATCH');
    expect(a.request.body).toEqual({ status: 'COMPLETADA', occurrenceStart: '2026-10-21T09:00:00.000Z' });
    a.flush({});
    await series;

    const simple = service.setStatus('t2', 'CANCELADA');
    const b = http.expectOne(`${API}/agenda/tasks/t2/status`);
    expect(b.request.body.occurrenceStart).toBeUndefined();
    b.flush({});
    await simple;
  });

  it('comentarios, checklist y etiquetas cuelgan de /agenda', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const comment = service.addComment('t1', 'Hecho');
    const c = http.expectOne(`${API}/agenda/tasks/t1/comments`);
    expect(c.request.body).toEqual({ text: 'Hecho' });
    c.flush({});
    await comment;

    const item = service.updateChecklistItem('t1', 'i1', { done: true });
    const i = http.expectOne(`${API}/agenda/tasks/t1/checklist/i1`);
    expect(i.request.method).toBe('PATCH');
    expect(i.request.body).toEqual({ done: true });
    i.flush({});
    await item;

    const label = service.createLabel('Urgente cliente');
    const l = http.expectOne(`${API}/agenda/labels`);
    expect(l.request.body).toEqual({ name: 'Urgente cliente' });
    l.flush({ id: 'l1', name: 'Urgente cliente' });
    await label;
  });

  it('uploadAttachment sube el fichero en multipart (campo "file")', async () => {
    const { service, http } = setupApiService(AgendaTasksService);

    const promise = service.uploadAttachment('t1', new File(['x'], 'presupuesto.pdf', { type: 'application/pdf' }));

    const req = http.expectOne(`${API}/agenda/tasks/t1/attachments`);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.flush({});
    await promise;
  });
});
