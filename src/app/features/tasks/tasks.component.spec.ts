import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { AgendaTask } from '../../core/agenda-tasks.model';
import { TasksComponent } from './tasks.component';
import { dateKey, startOfWeek } from './tasks.util';

function task(overrides: Partial<AgendaTask> = {}): AgendaTask {
  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    id: 't1', occurrenceKey: 't1', recurring: false,
    occurrenceStart: start.toISOString(), occurrenceEnd: end.toISOString(),
    title: 'Llamar al proveedor del ascensor',
    estate: { id: 'e1', name: 'Residencial San Miguel' }, assignee: { id: 'u1', fullName: 'Laura Martínez' },
    type: 'LLAMADA', priority: 'URGENTE', status: 'PENDIENTE', overdue: false, allDay: false, timezone: 'Europe/Madrid',
    startAt: start.toISOString(), endAt: end.toISOString(), reminderMinutesBefore: null, recurrence: null, labels: [],
    checklistDone: 0, checklistTotal: 0, commentCount: 0, attachmentCount: 0, linkCount: 0, source: 'manual', createdByUserId: 'u1',
    createdByKind: 'person', issueId: null, kind: null,
    ...overrides,
  };
}

type Harness = ComponentHarness<TasksComponent>;

const isList = (r: { url: string }) => r.url === `${API}/agenda/tasks`;

/** Resuelve catálogos, lista y resumen iniciales (el orden entre ellos no importa). */
async function open(items: AgendaTask[] = []): Promise<Harness> {
  const h = setupComponent(TasksComponent, { user: makeUser({ role: 'B', id: 'u1' }) });
  h.fixture.detectChanges();
  await settle();
  h.http.expectOne(`${API}/estates`).flush([]);
  h.http.expectOne(`${API}/agenda/assignees`).flush([{ id: 'u1', fullName: 'Laura Martínez' }]);
  h.http.expectOne(`${API}/agenda/labels`).flush([]);
  h.http.expectOne(isList).flush(items);
  await settle();
  h.fixture.detectChanges();
  return h;
}

async function react(h: Harness): Promise<void> {
  h.fixture.detectChanges();
  await settle();
  h.fixture.detectChanges();
}

describe('TasksComponent', () => {
  beforeEach(() => localStorage.clear());
  it('filtra desde el header y limpiar los filtros internos conserva la comunidad', async () => {
    const h = await open();
    h.component.catalog.estates.set([{ id: 'e1', name: 'Comunidad Sol' }] as never);
    await react(h);
    const selector = h.el.querySelector<HTMLSelectElement>('.topbar select[aria-label="Comunidad"]');
    expect(selector).not.toBeNull();
    selector!.value = 'e1';
    selector!.dispatchEvent(new Event('change', { bubbles: true }));
    await react(h);
    const request = h.http.expectOne(isList);
    expect(request.request.params.get('estateId')).toBe('e1');
    request.flush([]);
    await react(h);
    h.component.clearFilters();
    await react(h);
    h.http.match(isList).forEach(req => { expect(req.request.params.get('estateId')).toBe('e1'); req.flush([]); });
    expect(h.component.filters().estateId).toBe('e1');
    expect(h.el.querySelector('app-task-filters [aria-label="Comunidad"]')).toBeNull();
    h.http.verify();
  });

  describe('maquetación', () => {
    it('título y descripción comunes con Nueva tarea en la cabecera; fechas en el centro, búsqueda y vistas a los lados', async () => {
      const h = await open();

      const header = h.el.querySelector('.page-intro__text');
      expect(header?.firstElementChild?.matches('h1.page-intro__title')).toBe(true);
      expect(header?.firstElementChild?.nextElementSibling?.tagName).toBe('P');

      // La navegación por fechas ocupa el centro: «‹», Día/Semana/Mes, «›», Hoy y el rango. La búsqueda a la izquierda.
      const controls = h.el.querySelector('.controls') as HTMLElement;
      expect(Array.from(controls.children).map((e) => e.className)).toEqual(['controls__start', 'controls__nav', 'controls__end']);
      expect((controls.querySelector('.controls__start') as HTMLElement).querySelector('.search')).not.toBeNull();
      const nav = controls.querySelector('.controls__nav') as HTMLElement;
      expect(Array.from(nav.children).map((e) => e.getAttribute('aria-label') ?? e.className)).toEqual([
        'Periodo anterior', 'Periodo', 'Periodo siguiente', 'today-btn', 'period',
      ]);

      const end = h.el.querySelector('.controls__end') as HTMLElement;
      expect(end.querySelector('.view-toggle')).not.toBeNull();
      expect(end.textContent).not.toContain('Nueva tarea');
      expect(h.el.querySelector('.page-intro__actions')?.textContent).toContain('Nueva tarea');
      expect(end.parentElement).toBe(controls);
    });

    it('ya no hay tarjetas de KPI (Hoy, Esta semana, Urgentes, Vencidas) ni se pide el resumen', async () => {
      const h = await open([task()]);

      expect(h.el.querySelector('app-task-kpis, .kpi')).toBeNull();
      expect(h.http.match((r) => r.url.endsWith('/agenda/tasks/summary'))).toHaveLength(0);
    });
  });

  describe('forma de ver las tareas (tabla, kanban, calendario)', () => {
    const pressed = (h: Harness) =>
      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.view-toggle button'))
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.getAttribute('aria-label'));

    /** jsdom no tiene DragEvent/DataTransfer: un evento corriente con lo mínimo que usa el componente. */
    const dragEvent = (type: string): Event =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { setData: () => undefined, effectAllowed: '', dropEffect: '' } });

    it('por defecto es el calendario y los tres selectores existen', async () => {
      const h = await open([task()]);

      expect(h.component.mode()).toBe('calendar');
      expect(pressed(h)).toEqual(['Vista calendario']);
      expect(Array.from(h.el.querySelectorAll('.view-toggle button')).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Vista tabla', 'Vista kanban', 'Vista calendario',
      ]);
      expect(h.el.querySelector('app-task-time-grid')).not.toBeNull();
    });

    it('la tabla lista las tareas del periodo sin volver a pedir datos', async () => {
      const h = await open([task(), task({ id: 't2', occurrenceKey: 't2', title: 'Revisar extintores', priority: 'BAJA', assignee: null })]);

      h.component.setMode('table');
      await react(h);

      h.http.expectNone(isList);
      expect(pressed(h)).toEqual(['Vista tabla']);
      expect(h.el.querySelector('app-task-time-grid')).toBeNull();
      const rows = Array.from(h.el.querySelectorAll('app-task-table tbody tr'));
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('Llamar al proveedor del ascensor');
      expect(rows[0].textContent).toContain('Residencial San Miguel');
      expect(rows[0].textContent).toContain('Laura Martínez');
      expect(rows[1].textContent).toContain('Sin asignar');
      expect(Array.from(h.el.querySelectorAll('app-task-table th')).map((th) => th.textContent?.trim())).toEqual([
        '', 'Tarea', 'Comunidad', 'Responsable', 'Fecha', 'Prioridad', 'Estado',
      ]);
    });

    it('en la tabla un clic abre la ventana rápida y el doble clic el detalle', async () => {
      const h = await open([task()]);
      h.component.setMode('table');
      await react(h);

      h.el.querySelector<HTMLButtonElement>('app-task-table .title')?.click();
      expect(h.component.quick()?.task.id).toBe('t1');
      expect(h.component.selected()).toBeNull();

      h.el.querySelector<HTMLButtonElement>('app-task-table .title')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(h.component.quick()).toBeNull();
      expect(h.component.selected()?.id).toBe('t1');
    });

    describe('selección múltiple', () => {
      const two = () => [task(), task({ id: 't2', occurrenceKey: 't2', title: 'Revisar extintores' })];
      const boxes = (h: Harness) => Array.from(h.el.querySelectorAll<HTMLInputElement>('app-task-table tbody input.select-box'));
      const bulkBtn = (h: Harness, text: string) =>
        Array.from(h.el.querySelectorAll<HTMLButtonElement>('.bulk button')).find((b) => b.textContent?.includes(text));

      it('marcar filas muestra la barra y "seleccionar todas" marca todas', async () => {
        const h = await open(two());
        h.component.setMode('table');
        await react(h);
        expect(h.el.querySelector('.bulk')).toBeNull();

        boxes(h)[0].click();
        await react(h);
        expect(h.el.querySelector('.bulk__count')?.textContent).toContain('1 seleccionada');

        h.el.querySelector<HTMLInputElement>('app-task-table thead input.select-box')!.click();
        await react(h);
        expect(h.el.querySelector('.bulk__count')?.textContent).toContain('2 seleccionadas');
      });

      it('cambia en bloque el estado de las marcadas, salta las decisiones y deja las que fallan', async () => {
        const h = await open([...two(), task({ id: 't3', occurrenceKey: 't3', kind: 'APPROVE' })]);
        h.component.setMode('table');
        await react(h);
        h.component.checkedKeys.set(['t1', 't2', 't3']);
        await react(h);

        h.component.changeCheckedStatus('COMPLETADA');
        await settle();
        h.http.expectOne(`${API}/agenda/tasks/t1/status`).flush({});
        h.http.expectOne(`${API}/agenda/tasks/t2/status`).flush({ message: 'x' }, { status: 400, statusText: 'Bad Request' });
        h.http.expectNone(`${API}/agenda/tasks/t3/status`);
        await settle();

        expect(h.component.checkedKeys()).toEqual(['t2']);
        h.http.match(isList).forEach((r) => r.flush(two()));
      });

      it('elimina en bloque tras confirmar', async () => {
        const h = await open(two());
        h.component.setMode('table');
        await react(h);
        h.component.checkedKeys.set(['t1', 't2']);
        await react(h);

        bulkBtn(h, 'Eliminar')!.click();
        await react(h);
        expect(h.el.querySelector('#bulk-title')?.textContent).toContain('2 tareas');
        h.http.expectNone(`${API}/agenda/tasks/t1`);

        h.el.querySelector<HTMLButtonElement>('.confirm .btn--danger')!.click();
        await settle();
        h.http.expectOne(`${API}/agenda/tasks/t1`).flush(null, { status: 204, statusText: 'No Content' });
        h.http.expectOne(`${API}/agenda/tasks/t2`).flush(null, { status: 204, statusText: 'No Content' });
        await settle();

        expect(h.component.checkedKeys()).toEqual([]);
        h.http.match(isList).forEach((r) => r.flush([]));
      });
    });


    it('con la tabla sin tareas no se muestra una tabla vacía', async () => {
      const h = await open();

      h.component.setMode('table');
      await react(h);

      expect(h.el.querySelector('.empty-banner')).toBeNull();
      expect(h.el.querySelector('app-task-table')).toBeNull();
    });

    it('el kanban agrupa las tareas por estado, una columna por estado', async () => {
      const h = await open([
        task({ id: 'a', occurrenceKey: 'a', title: 'Pendiente A', status: 'PENDIENTE' }),
        task({ id: 'b', occurrenceKey: 'b', title: 'En curso B', status: 'EN_CURSO' }),
        task({ id: 'c', occurrenceKey: 'c', title: 'Hecha C', status: 'COMPLETADA' }),
      ]);

      h.component.setMode('kanban');
      await react(h);

      const columns = Array.from(h.el.querySelectorAll('app-task-kanban .column'));
      expect(columns.map((c) => c.querySelector('h3')?.textContent?.trim())).toEqual(['Pendiente', 'En curso', 'En espera', 'Completada', 'Cancelada']);
      expect(columns.map((c) => c.querySelectorAll('.card').length)).toEqual([1, 1, 0, 1, 0]);
      expect(columns[0].textContent).toContain('Pendiente A');
      expect(columns[3].textContent).toContain('Hecha C');
      expect(columns[2].textContent).toContain('Sin tareas');
    });

    it('arrastrar una tarjeta a otra columna cambia su estado en el servidor y refresca', async () => {
      const h = await open([task({ status: 'PENDIENTE' })]);
      h.component.setMode('kanban');
      await react(h);

      const column = h.el.querySelectorAll<HTMLElement>('app-task-kanban .column')[1];
      const card = h.el.querySelector<HTMLElement>('app-task-kanban .card') as HTMLElement;
      card.dispatchEvent(dragEvent('dragstart'));
      column.dispatchEvent(dragEvent('drop'));
      await settle();

      const req = h.http.expectOne(`${API}/agenda/tasks/t1/status`);
      expect(req.request.body).toEqual({ status: 'EN_CURSO' });
      req.flush({});
      await react(h);
      h.http.expectOne(isList).flush([task({ status: 'EN_CURSO' })]);
      await react(h);
      expect(h.el.querySelectorAll('app-task-kanban .column')[1].querySelectorAll('.card')).toHaveLength(1);
    });

    it('soltar en la misma columna no hace ninguna petición', async () => {
      const h = await open([task({ status: 'PENDIENTE' })]);
      h.component.setMode('kanban');
      await react(h);

      const column = h.el.querySelectorAll<HTMLElement>('app-task-kanban .column')[0];
      const card = column.querySelector<HTMLElement>('.card') as HTMLElement;
      card.dispatchEvent(dragEvent('dragstart'));
      column.dispatchEvent(dragEvent('drop'));
      await settle();

      h.http.expectNone(`${API}/agenda/tasks/t1/status`);
    });

    it('en una serie el cambio de estado solo afecta a la ocurrencia arrastrada', async () => {
      const occurrence = task({ recurring: true, occurrenceKey: 't1:2026-10-14', occurrenceStart: '2026-10-14T07:00:00.000Z' });
      const h = await open([occurrence]);

      const pending = h.component.onStatusChange({ task: occurrence, status: 'COMPLETADA' });
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1/status`);
      expect(req.request.body).toEqual({ status: 'COMPLETADA', occurrenceStart: '2026-10-14T07:00:00.000Z' });
      req.flush({});
      await pending;
      await settle();
      h.http.match(isList).forEach((r) => r.flush([]));
    });

    it('si el servidor rechaza el cambio de estado se avisa y la tarjeta no se mueve', async () => {
      const h = await open([task({ status: 'PENDIENTE' })]);
      h.component.setMode('kanban');
      await react(h);

      const pending = h.component.onStatusChange({ task: task({ status: 'PENDIENTE' }), status: 'CANCELADA' });
      await settle();
      h.http.expectOne(`${API}/agenda/tasks/t1/status`).flush('boom', { status: 500, statusText: 'Server Error' });
      await pending;
      await react(h);

      expect(h.component.notice()).toMatchObject({ tone: 'error' });
      expect(h.el.querySelectorAll('app-task-kanban .column')[0].querySelectorAll('.card')).toHaveLength(1);
    });

    it('la forma elegida se guarda y se recupera al volver a la pantalla', async () => {
      const h = await open();

      h.el.querySelector<HTMLButtonElement>('.view-toggle button[aria-label="Vista kanban"]')?.click();
      await react(h);
      expect(localStorage.getItem('domora-tasks-mode')).toBe('kanban');
    });

    it('arranca con la forma guardada y ignora valores desconocidos', async () => {
      localStorage.setItem('domora-tasks-mode', 'kanban');
      const saved = await open();
      expect(saved.component.mode()).toBe('kanban');
      expect(saved.el.querySelector('app-task-kanban')).not.toBeNull();
    });
  });

  describe('carga', () => {
    it('pide al servidor SOLO la semana en curso (de lunes a lunes), no todo el historial', async () => {
      const h = setupComponent(TasksComponent, { user: makeUser({ role: 'B' }) });
      h.fixture.detectChanges();
      await settle();
      h.http.match(() => true).forEach((r) => {
        if (isList(r.request)) {
          const monday = startOfWeek(new Date());
          const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
          expect(r.request.params.get('from')).toBe(monday.toISOString());
          expect(r.request.params.get('to')).toBe(nextMonday.toISOString());
          expect(r.request.params.has('overdue')).toBe(false);
        }
        r.flush([]);
      });
      expect(h.component.view()).toBe('week');
    });

    it('muestra el periodo actual y la vista por defecto es Semana', async () => {
      const h = await open();

      expect(h.el.querySelector('.period')?.textContent).toMatch(/\d{1,2} .*\d{4}/);
      expect(h.el.querySelector('.segmented__btn--on')?.textContent?.trim()).toBe('Semana');
    });

    it('error de carga: aviso con reintento que vuelve a pedir los datos', async () => {
      const h = setupComponent(TasksComponent, { user: makeUser({ role: 'B' }) });
      h.fixture.detectChanges();
      await settle();
      h.http.expectOne(`${API}/estates`).flush([]);
      h.http.expectOne(`${API}/agenda/assignees`).flush([]);
      h.http.expectOne(`${API}/agenda/labels`).flush([]);
      h.http.expectOne(isList).flush('boom', { status: 500, statusText: 'Server Error' });
      await react(h);

      expect(h.el.querySelector('.state--error')?.textContent).toContain('No se pudieron cargar las tareas');

      const retry = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.state--error button')).find((b) => b.textContent?.includes('Reintentar'));
      retry?.click();
      await react(h);
      h.http.expectOne(isList).flush([]);
    });
  });

  describe('filtros y búsqueda', () => {
    it('los filtros se combinan en una única consulta al servidor', async () => {
      const h = await open();

      h.component.changeEstate('e1');
      h.component.onFilters({ estateId: 'e1', assignee: 'me', status: 'EN_CURSO', priority: 'ALTA', type: 'VISITA', labelIds: ['l1', 'l2'] });
      await react(h);

      const req = h.http.expectOne(isList);
      expect(req.request.params.get('estateId')).toBe('e1');
      expect(req.request.params.get('assignee')).toBe('me');
      expect(req.request.params.get('status')).toBe('EN_CURSO');
      expect(req.request.params.get('priority')).toBe('ALTA');
      expect(req.request.params.get('type')).toBe('VISITA');
      expect(req.request.params.get('labelIds')).toBe('l1,l2');
      req.flush([]);
    });

    it('la búsqueda espera a que se deje de escribir antes de pedir datos', async () => {
      const h = await open();
      vi.useFakeTimers();
      try {
        h.component.onSearch('asc');
        h.component.onSearch('ascensor');
        await vi.advanceTimersByTimeAsync(200);
        h.fixture.detectChanges();
        h.http.expectNone(isList);

        await vi.advanceTimersByTimeAsync(150);
        h.fixture.detectChanges();
        const req = h.http.expectOne(isList);
        expect(req.request.params.get('q')).toBe('ascensor');
        req.flush([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('con filtros activos y sin resultados ofrece limpiar filtros', async () => {
      const h = await open();
      h.component.onFilters({ estateId: '', assignee: '', status: '', priority: 'BAJA', type: '', labelIds: [] });
      await react(h);
      h.http.expectOne(isList).flush([]);
      await react(h);

      expect(h.el.querySelector('.empty-banner')?.textContent).toContain('No hay tareas que coincidan con estos filtros.');

      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.empty-banner button')).find((b) => b.textContent?.includes('Limpiar filtros'))?.click();
      await react(h);
      expect(h.component.filters().priority).toBe('');
      h.http.match(() => true).forEach((r) => r.flush([]));
    });
  });

  describe('estados vacíos', () => {
    it('sin filtros y sin tareas no se muestra ningún banner de vacío', async () => {
      const h = await open();

      h.component.setView('day');
      await react(h);
      h.http.expectOne(isList).flush([]);
      await react(h);

      expect(h.el.querySelector('.empty-banner')).toBeNull();
    });
  });

  describe('crear y editar', () => {
    it('"Nueva tarea" abre el diálogo', async () => {
      const h = await open();

      const button = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.page-intro__actions button')).find((b) => b.textContent?.includes('Nueva tarea'));
      expect(button).toBeDefined();
      button!.click();
      await react(h);

      expect(h.el.querySelector('app-task-form-dialog')).not.toBeNull();
    });

    it('hacer clic en un hueco del calendario abre el diálogo con día y hora preseleccionados', async () => {
      const h = await open();
      const thursday = new Date(2026, 9, 15);

      h.component.onSlot({ date: thursday, minutes: 10 * 60 });
      await react(h);

      const dialog = h.el.querySelector('app-task-form-dialog');
      expect(dialog).not.toBeNull();
      expect(dialog?.querySelector('.dtf__value')?.textContent?.trim()).toBe('15/10/2026');
      expect((dialog?.querySelector('.dtf__input') as HTMLInputElement).value).toBe('10:00');
    });

    it('un clic en una tarea abre la ventana rápida con título, fecha, asignado y acciones', async () => {
      const h = await open([task()]);

      h.component.select(h.component.items()[0]);
      await react(h);

      const quick = h.el.querySelector('.quick');
      expect(quick?.querySelector('.quick__title')?.textContent).toContain('Llamar al proveedor del ascensor');
      expect(quick?.textContent).toContain('Asignado a');
      expect(quick?.querySelector('app-dropdown')).not.toBeNull();
      expect(h.el.querySelector('app-task-drawer')).toBeNull();
    });

    it('la ventana rápida no rotula la fecha y solo las tareas de incidencia ofrecen «Ir a la incidencia»', async () => {
      const manual = await open([task()]);
      manual.component.select(manual.component.items()[0]);
      await react(manual);
      expect(manual.el.querySelector('.quick')?.textContent).not.toContain('Fecha');
      expect(manual.el.querySelector('.quick__footer app-btn')).toBeNull();
    });

    it('una tarea de incidencia ofrece «Ir a la incidencia» en la ventana rápida', async () => {
      const issue = await open([task({ type: 'INCIDENCIA', issueId: 'i1' })]);
      issue.component.select(issue.component.items()[0]);
      await react(issue);
      const go = issue.el.querySelector('.quick__footer app-btn');
      expect(go?.textContent).toContain('Ir a la incidencia');
    });

    it('doble clic en una tarea abre el panel de detalle y carga su ficha', async () => {
      const h = await open([task()]);

      h.component.open(h.component.items()[0]);
      await react(h);

      h.http.expectOne(`${API}/agenda/tasks/t1`).flush({ ...task(), description: null, createdBy: null, createdAt: '', updatedAt: '', checklist: [], comments: [], attachments: [], links: [] });
      await react(h);
      expect(h.el.querySelector('app-task-drawer')).not.toBeNull();
      expect((h.el.querySelector('app-task-drawer textarea.title') as HTMLTextAreaElement).value).toBe('Llamar al proveedor del ascensor');
    });

    it('eliminar pide confirmación y no borra hasta confirmar', async () => {
      const h = await open([task()]);

      h.component.askDelete(h.component.items()[0]);
      await react(h);
      expect(h.el.querySelector('.confirm')?.textContent).toContain('¿Eliminar esta tarea?');
      h.http.expectNone((r) => r.method === 'DELETE');

      h.component.confirmRemoval();
      await settle();
      const del = h.http.expectOne(`${API}/agenda/tasks/t1`);
      expect(del.request.method).toBe('DELETE');
      del.flush(null);
      await react(h);
      h.http.match(() => true).forEach((r) => r.flush([]));
    });
  });

  describe('arrastrar y soltar', () => {
    const target = new Date(2026, 9, 15, 12, 0);

    it('mueve la tarea conservando su duración y refresca al confirmar el servidor', async () => {
      const t = task(); // 09:00 – 10:00
      const h = await open([t]);

      const moving = h.component.onMoved({ task: t, start: target });
      await settle();
      expect(h.component.items()[0].occurrenceStart).toBe(target.toISOString());
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body.startAt).toBe(target.toISOString());
      expect(req.request.body.endAt).toBe(new Date(target.getTime() + 3_600_000).toISOString());
      expect(req.request.body.allDay).toBe(false);
      req.flush({});
      await moving;
      await react(h);
      h.http.match(() => true).forEach((r) => r.flush([t]));
    });

    it('si el servidor lo rechaza, restaura la posición anterior y avisa', async () => {
      const t = task();
      const h = await open([t]);

      const moving = h.component.onMoved({ task: t, start: target });
      await settle();
      h.http.expectOne(`${API}/agenda/tasks/t1`).flush('no', { status: 403, statusText: 'Forbidden' });
      await moving;

      expect(h.component.items()[0].occurrenceStart).toBe(t.occurrenceStart);
      expect(h.component.notice()).toMatchObject({ tone: 'error' });
    });

    it('una tarea de día completo se mueve de día sin cambiar su hora', async () => {
      const t = task({ allDay: true, occurrenceStart: '2026-10-14T00:00:00.000Z', occurrenceEnd: '2026-10-15T00:00:00.000Z', startAt: '2026-10-14T00:00:00.000Z', endAt: '2026-10-15T00:00:00.000Z' });
      const h = await open([t]);

      const moving = h.component.onMoved({ task: t, start: new Date(2026, 9, 16) });
      await settle();
      const req = h.http.expectOne(`${API}/agenda/tasks/t1`);
      expect(req.request.body.startAt).toBe('2026-10-16T00:00:00.000Z');
      expect(req.request.body.endAt).toBe('2026-10-17T00:00:00.000Z');
      expect(req.request.body.allDay).toBe(true);
      req.flush({});
      await moving;
      await react(h);
      h.http.match(() => true).forEach((r) => r.flush([t]));
    });

    it('soltar en la misma posición no hace ninguna petición', async () => {
      const t = task();
      const h = await open([t]);

      await h.component.onMoved({ task: t, start: new Date(t.occurrenceStart) });

      h.http.expectNone((r) => r.method === 'PATCH');
    });
  });

  it('el calendario pinta la tarea con icono, prioridad y accesible por teclado (botón)', async () => {
    const h = await open([task()]);

    const block = h.el.querySelector<HTMLButtonElement>('.block');
    expect(block).not.toBeNull();
    expect(block?.getAttribute('aria-label')).toContain('Llamar al proveedor del ascensor');
    expect(block?.getAttribute('aria-label')).toContain('prioridad urgente');
    expect(block?.classList.contains('block--urgente')).toBe(true);
    expect(dateKey(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('estados de la interfaz', () => {
    it('al navegar por el calendario se conservan los datos anteriores (atenuados) en lugar de parpadear con un esqueleto', async () => {
      const h = await open([task()]);

      h.component.move(1);
      await react(h);

      expect(h.component.showSkeleton()).toBe(false);
      h.http.expectOne(isList).flush([]);
    });

    it('si fallan los catálogos (comunidades, equipo, etiquetas) se avisa con un botón de reintento', async () => {
      const h = setupComponent(TasksComponent, { user: makeUser({ role: 'B', id: 'u1' }) });
      h.fixture.detectChanges();
      await settle();
      h.http.expectOne(`${API}/estates`).flush([]);
      h.http.expectOne(`${API}/agenda/assignees`).flush('boom', { status: 500, statusText: 'Server Error' });
      h.http.expectOne(`${API}/agenda/labels`).flush([]);
      h.http.expectOne(isList).flush([]);
      await react(h);

      expect(h.el.textContent).toContain('No se pudieron cargar las comunidades, el equipo y las etiquetas');

      Array.from(h.el.querySelectorAll<HTMLButtonElement>('.state--error button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
      await settle();
      h.http.expectOne(`${API}/estates`).flush([]);
      h.http.expectOne(`${API}/agenda/assignees`).flush([]);
      h.http.expectOne(`${API}/agenda/labels`).flush([]);
      await react(h);
      expect(h.el.textContent).not.toContain('No se pudieron cargar las comunidades');
    });
  });

});
