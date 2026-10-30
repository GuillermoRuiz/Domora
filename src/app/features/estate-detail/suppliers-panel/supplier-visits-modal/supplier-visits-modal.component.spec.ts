import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import type { SupplierPanelRow, SupplierVisit } from '../../../../core/supplier-panel.models';
import { SupplierVisitsModalComponent } from './supplier-visits-modal.component';

const SUPPLIER: SupplierPanelRow = {
  id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo', contactName: 'Marta Ruiz', phone: null, email: null,
  displayStatus: 'activo', contract: null, nextVisit: null, openIssues: 0,
};

function visit(overrides: Partial<SupplierVisit> = {}): SupplierVisit {
  return {
    id: 'v1', supplierId: 's1', estateId: 'e1', scheduledAt: '2030-03-01T09:30:00.000Z', purpose: 'Revisión mensual', status: 'planificada',
    notes: null, completedAt: null, cancelledAt: null, asset: null, issue: null, ...overrides,
  };
}

const INSTALLATIONS = { items: [{ id: 'a2', name: 'Piscina' }, { id: 'a1', name: 'Ascensor A' }], upcoming: [] };

describe('SupplierVisitsModalComponent', () => {
  let h: ComponentHarness<SupplierVisitsModalComponent>;
  const visitsUrl = `${API}/estates/e1/suppliers/s1/visits`;

  /** ngModel dentro de un formulario registra sus controles en un microtask: hay que esperarlo antes de escribir o leer. */
  async function flushUi(): Promise<void> {
    await settle();
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }

  async function mount(visits: SupplierVisit[] | { status: number }, startWithForm = false): Promise<void> {
    h = setupComponent(SupplierVisitsModalComponent);
    h.component.estateId = 'e1';
    h.component.supplier = SUPPLIER;
    h.component.startWithForm = startWithForm;
    h.fixture.detectChanges();
    if (startWithForm) h.http.expectOne(`${API}/estates/e1/installations`).flush(INSTALLATIONS);
    const req = h.http.expectOne(visitsUrl);
    if ('status' in visits) req.flush({ message: 'x' }, { status: visits.status, statusText: 'Error' });
    else req.flush(visits);
    await flushUi();
  }
  const field = (id: string) => h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const type = (id: string, value: string, event = 'input') => {
    field(id).value = value;
    field(id).dispatchEvent(new Event(event));
    h.fixture.detectChanges();
  };
  const click = (selector: string) => {
    (h.el.querySelector(selector) as HTMLElement).click();
    h.fixture.detectChanges();
  };
  const submit = async () => {
    (h.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    h.fixture.detectChanges();
    await settle();
  };
  const rows = () => Array.from(h.el.querySelectorAll('[data-visit]'));
  const purposes = () => rows().map(r => r.querySelector('.visit__purpose')?.textContent?.trim());
  const row = (id: string) => h.el.querySelector(`[data-visit="${id}"]`) as HTMLElement;

  afterEach(() => h.http.verify());

  describe('lista', () => {
    it('pone primero las planificadas (la más cercana arriba) y después el histórico (lo más reciente arriba)', async () => {
      await mount([
        visit({ id: 'old', purpose: 'Antigua', status: 'realizada', scheduledAt: '2026-01-10T10:00:00.000Z' }),
        visit({ id: 'later', purpose: 'Más adelante', scheduledAt: '2030-06-01T10:00:00.000Z' }),
        visit({ id: 'recent', purpose: 'Reciente', status: 'cancelada', scheduledAt: '2026-09-10T10:00:00.000Z' }),
        visit({ id: 'soon', purpose: 'Pronto', scheduledAt: '2030-02-01T10:00:00.000Z' }),
      ]);
      expect(purposes()).toEqual(['Pronto', 'Más adelante', 'Reciente', 'Antigua']);
      expect(h.el.querySelector('.modal__subtitle')?.textContent).toContain('Ascensores Levante');
    });

    it('cada visita muestra su estado, instalación, incidencia y notas', async () => {
      await mount([visit({ status: 'realizada', notes: 'Todo bien', asset: { id: 'a1', name: 'Ascensor A' }, issue: { id: 'i1', ref: '#INC-1', title: 'Ruido' } })]);
      expect(row('v1').querySelector('app-status-pill')?.textContent?.trim()).toBe('Realizada');
      expect(row('v1').textContent).toContain('Instalación: Ascensor A · Incidencia #INC-1');
      expect(row('v1').textContent).toContain('Todo bien');
    });

    it('solo las planificadas tienen acciones: realizada, editar y cancelar', async () => {
      await mount([visit({ id: 'p' }), visit({ id: 'd', status: 'realizada' }), visit({ id: 'c', status: 'cancelada' })]);
      expect(row('p').querySelectorAll('.visit__actions button')).toHaveLength(3);
      expect(row('d').querySelector('.visit__actions')).toBeNull();
      expect(row('c').querySelector('.visit__actions')).toBeNull();
    });

    it('sin visitas lo dice y ofrece programar la primera', async () => {
      await mount([]);
      expect(h.el.textContent).toContain('Este proveedor aún no tiene visitas');
      expect(h.el.querySelector('[data-action="new-visit"]')).not.toBeNull();
    });

    it('si no se pueden cargar, lo dice', async () => {
      await mount({ status: 500 });
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar las visitas');
    });
  });

  describe('programar una visita', () => {
    it('«Programar visita» abre el formulario y carga las instalaciones, ordenadas', async () => {
      await mount([]);
      click('[data-action="new-visit"] button');
      h.http.expectOne(`${API}/estates/e1/installations`).flush(INSTALLATIONS);
      await flushUi();
      expect(h.el.querySelector('h4')?.textContent).toContain('Programar visita');
      expect(field('sv-time').value).toBe('09:00');
      expect(Array.from(field('sv-asset').querySelectorAll('option')).map(o => o.textContent?.trim())).toEqual(['Sin instalación', 'Ascensor A', 'Piscina']);
    });

    it('con startWithForm abre directamente el formulario', async () => {
      await mount([], true);
      expect(h.el.querySelector('h4')?.textContent).toContain('Programar visita');
      expect(h.el.querySelector('[data-list="visits"]')).toBeNull();
    });

    it('sin fecha ni motivo no envía nada y los marca', async () => {
      await mount([], true);
      await submit();
      h.http.expectNone((r) => r.method === 'POST');
      const errors = Array.from(h.el.querySelectorAll('.field-error')).map(e => e.textContent?.trim());
      expect(errors).toContain('Elige la fecha de la visita');
      expect(errors).toContain('El motivo es obligatorio');
    });

    it('crea la visita con fecha y hora locales, motivo e instalación; recarga, avisa al panel y vuelve a la lista', async () => {
      await mount([], true);
      let changed = 0;
      h.component.changed.subscribe(() => changed++);
      type('sv-date', '2030-03-01');
      type('sv-time', '10:30');
      type('sv-purpose', '  Revisión mensual  ');
      type('sv-asset', 'a1', 'change');
      await submit();
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === visitsUrl);
      expect(req.request.body).toEqual({ scheduledAt: new Date('2030-03-01T10:30').toISOString(), purpose: 'Revisión mensual', assetId: 'a1' });
      req.flush(visit());
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([visit({ asset: { id: 'a1', name: 'Ascensor A' } })]);
      await flushUi();
      expect(changed).toBe(1);
      expect(h.el.querySelector('[data-list="visits"]')).not.toBeNull();
      expect(rows()).toHaveLength(1);
    });

    it('sin instalación ni notas no las envía', async () => {
      await mount([], true);
      type('sv-date', '2030-03-01');
      type('sv-purpose', 'Presupuesto');
      await submit();
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === visitsUrl);
      expect(req.request.body).toEqual({ scheduledAt: new Date('2030-03-01T09:00').toISOString(), purpose: 'Presupuesto' });
      req.flush(visit());
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([]);
      await flushUi();
    });

    it('si el servidor lo rechaza enseña su mensaje y se queda en el formulario', async () => {
      await mount([], true);
      let changed = 0;
      h.component.changed.subscribe(() => changed++);
      type('sv-date', '2030-03-01');
      type('sv-purpose', 'Presupuesto');
      await submit();
      h.http.expectOne((r) => r.method === 'POST').flush({ message: 'No se puede programar una visita a un proveedor de baja.' }, { status: 400, statusText: 'Bad Request' });
      await flushUi();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('proveedor de baja');
      expect(h.el.querySelector('h4')?.textContent).toContain('Programar visita');
      expect(changed).toBe(0);
    });

    it('«Volver» deja el formulario sin guardar nada', async () => {
      await mount([visit()], true);
      click('.modal__footer app-btn button');
      expect(h.el.querySelector('[data-list="visits"]')).not.toBeNull();
      h.http.expectNone((r) => r.method === 'POST');
    });
  });

  describe('editar una visita', () => {
    it('rellena el formulario con los datos de la visita en hora local', async () => {
      await mount([visit({ notes: 'Llevar llave', asset: { id: 'a1', name: 'Ascensor A' } })]);
      click('[data-action="edit"]');
      h.http.expectOne(`${API}/estates/e1/installations`).flush(INSTALLATIONS);
      await flushUi();
      const when = new Date('2030-03-01T09:30:00.000Z');
      const p = (n: number) => String(n).padStart(2, '0');
      expect(h.el.querySelector('h4')?.textContent).toContain('Editar visita');
      expect(field('sv-date').value).toBe(`${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}`);
      expect(field('sv-time').value).toBe(`${p(when.getHours())}:${p(when.getMinutes())}`);
      expect(field('sv-purpose').value).toBe('Revisión mensual');
      expect(field('sv-notes').value).toBe('Llevar llave');
    });

    it('guarda los cambios y un campo vaciado (notas, instalación) se envía como null', async () => {
      await mount([visit({ notes: 'Llevar llave', asset: { id: 'a1', name: 'Ascensor A' } })]);
      click('[data-action="edit"]');
      h.http.expectOne(`${API}/estates/e1/installations`).flush(INSTALLATIONS);
      await flushUi();
      type('sv-purpose', 'Otra cosa');
      type('sv-notes', '');
      type('sv-asset', '', 'change');
      await submit();
      const req = h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${visitsUrl}/v1`);
      expect(req.request.body).toEqual({ scheduledAt: new Date('2030-03-01T09:30:00.000Z').toISOString(), purpose: 'Otra cosa', notes: null, assetId: null });
      req.flush(visit());
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([visit({ purpose: 'Otra cosa' })]);
      await flushUi();
      expect(purposes()).toEqual(['Otra cosa']);
    });
  });

  describe('cerrar una visita', () => {
    it('«Realizada» pide notas opcionales y al confirmar la marca como hecha', async () => {
      await mount([visit()]);
      let changed = 0;
      h.component.changed.subscribe(() => changed++);
      click('[data-action="complete"]');
      expect(row('v1').querySelector('.visit__actions')).toBeNull();
      type('sv-close-v1', 'Todo correcto');
      click('[data-action="confirm-close"] button');
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === `${visitsUrl}/v1/complete`);
      expect(req.request.body).toEqual({ notes: 'Todo correcto' });
      req.flush(visit({ status: 'realizada' }));
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([visit({ status: 'realizada', notes: 'Todo correcto' })]);
      await flushUi();
      expect(changed).toBe(1);
      expect(row('v1').querySelector('app-status-pill')?.textContent?.trim()).toBe('Realizada');
      expect(row('v1').querySelector('.visit__actions')).toBeNull();
    });

    it('«Cancelar» sin motivo no envía notas', async () => {
      await mount([visit()]);
      click('[data-action="cancel"]');
      click('[data-action="confirm-close"] button');
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === `${visitsUrl}/v1/cancel`);
      expect(req.request.body).toEqual({});
      req.flush(visit({ status: 'cancelada' }));
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([visit({ status: 'cancelada' })]);
      await flushUi();
      expect(row('v1').querySelector('app-status-pill')?.textContent?.trim()).toBe('Cancelada');
    });

    it('«Volver» descarta el cierre y no llama al servidor', async () => {
      await mount([visit()]);
      click('[data-action="complete"]');
      click('.visit__close-actions app-btn button');
      expect(row('v1').querySelector('.visit__actions')).not.toBeNull();
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('si falla el cierre lo dice y la visita sigue planificada', async () => {
      await mount([visit()]);
      click('[data-action="complete"]');
      click('[data-action="confirm-close"] button');
      h.http.expectOne((r) => r.method === 'POST').flush({ message: 'Solo se puede modificar una visita planificada.' }, { status: 400, statusText: 'Bad Request' });
      await flushUi();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('Solo se puede modificar una visita planificada.');
      expect(row('v1').querySelector('app-status-pill')?.textContent?.trim()).toBe('Planificada');
    });
  });
});
