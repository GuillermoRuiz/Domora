import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { Installation } from '../../../core/installations.models';
import { InstallationFormModalComponent } from './installation-form-modal.component';

const SUPPLIERS = [{ id: 's1', name: 'Ascensores Levante' }, { id: 's2', name: 'Calefacciones Turia' }];

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'a1', name: 'Ascensor A', category: 'Ascensores', location: 'Portal 1', manufacturer: 'Orona', serialNumber: 'SN-1', notes: 'Revisión anual',
    operationalStatus: 'operativa', displayStatus: 'operativa', supplier: { id: 's1', name: 'Ascensores Levante' },
    lastReviewDate: null, nextReviewDate: null, nextReviewDaysLeft: null, openIssues: 0, ...overrides,
  };
}

describe('InstallationFormModalComponent', () => {
  let h: ComponentHarness<InstallationFormModalComponent>;

  /** ngModel dentro de un formulario registra sus controles en un microtask: hay que esperarlo antes de escribir o leer. */
  async function mount(target: Installation | null = null): Promise<void> {
    h = setupComponent(InstallationFormModalComponent);
    h.component.estateId = 'e1';
    h.component.installation = target;
    h.component.suppliers = SUPPLIERS;
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }
  const field = (id: string) => h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const type = (id: string, value: string, event = 'input') => {
    field(id).value = value;
    field(id).dispatchEvent(new Event(event));
    h.fixture.detectChanges();
  };
  const submit = async () => {
    (h.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  };
  const request = (method: string, path: string) => h.http.expectOne((r) => r.method === method && r.url === `${API}${path}`);

  afterEach(() => h.http.verify());

  describe('alta', () => {
    beforeEach(async () => { await mount(); });

    it('título, botón y campos de una instalación nueva (tipo Ascensor y estado Operativa por defecto)', () => {
      expect(h.el.querySelector('h4')?.textContent).toContain('Nueva instalación');
      expect(h.el.querySelector('[type="submit"]')?.textContent).toContain('Crear instalación');
      expect(field('if-type').value).toBe('ascensor');
      expect(field('if-status').value).toBe('operativa');
      expect(Array.from(field('if-supplier').querySelectorAll('option')).map(o => o.textContent?.trim())).toEqual(['Sin proveedor', 'Ascensores Levante', 'Calefacciones Turia']);
    });

    it('sin nombre no envía nada y lo marca', async () => {
      await submit();
      h.http.expectNone((r) => r.method === 'POST');
      expect(h.el.querySelector('.field-error')?.textContent).toContain('El nombre es obligatorio');
    });

    it('crea con el tipo del catálogo, estado y proveedor, y solo manda lo que se rellenó', async () => {
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      type('if-name', '  Caldera común  ');
      type('if-type', 'calefaccion', 'change');
      type('if-status', 'en_mantenimiento', 'change');
      type('if-supplier', 's2', 'change');
      type('if-location', 'Sala de calderas');
      await submit();
      const req = request('POST', '/estates/e1/assets');
      expect(req.request.body).toEqual({
        name: 'Caldera común', category: 'Calefacción / ACS', location: 'Sala de calderas', operationalStatus: 'en_mantenimiento', supplierId: 's2',
      });
      req.flush({ id: 'new' });
      await settle();
      expect(saved).toHaveBeenCalledTimes(1);
    });

    it('"Otro" pide una descripción y la guarda como tipo (o "Otro" si se deja vacía)', async () => {
      type('if-name', 'Depósito');
      type('if-type', 'otro', 'change');
      await settle();
      h.fixture.detectChanges();
      type('if-other', 'Depósito de agua');
      await submit();
      const req = request('POST', '/estates/e1/assets');
      expect(req.request.body.category).toBe('Depósito de agua');
      req.flush({ id: 'new' });
      await settle();
    });

    it('si el servidor rechaza muestra su mensaje y no cierra', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      type('if-name', 'X');
      await submit();
      request('POST', '/estates/e1/assets').flush({ message: 'El proveedor indicado no pertenece a esta finca.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('El proveedor indicado no pertenece a esta finca.');
      expect(saved).not.toHaveBeenCalled();
    });

    it('Cancelar y la X cierran sin guardar', () => {
      const closed = vi.fn();
      h.component.closed.subscribe(closed);
      (h.el.querySelector('.close-btn') as HTMLButtonElement).click();
      (Array.from(h.el.querySelectorAll('app-btn')).find(b => b.textContent?.includes('Cancelar'))!.querySelector('button') as HTMLButtonElement).click();
      expect(closed).toHaveBeenCalledTimes(2);
    });
  });

  describe('edición', () => {
    it('precarga todos los datos y el título lo dice', async () => {
      await mount(installation());
      expect(h.el.querySelector('h4')?.textContent).toContain('Editar instalación');
      expect(field('if-name').value).toBe('Ascensor A');
      expect(field('if-type').value).toBe('ascensor');
      expect(field('if-location').value).toBe('Portal 1');
      expect(field('if-supplier').value).toBe('s1');
      expect(field('if-manufacturer').value).toBe('Orona');
      expect(field('if-serial').value).toBe('SN-1');
      expect(field('if-notes').value).toBe('Revisión anual');
    });

    it('conserva el texto original del tipo mientras no se cambie ("Ascensores" no pasa a "Ascensor")', async () => {
      await mount(installation());
      type('if-name', 'Ascensor A (nuevo)');
      await submit();
      const req = request('PATCH', '/estates/e1/assets/a1');
      expect(req.request.body.category).toBe('Ascensores');
      expect(req.request.body.name).toBe('Ascensor A (nuevo)');
      req.flush({ id: 'a1' });
      await settle();
    });

    it('al vaciar un campo opcional o quitar el proveedor manda null (borra), no una cadena vacía', async () => {
      await mount(installation());
      type('if-location', '');
      type('if-manufacturer', '   ');
      type('if-supplier', '', 'change');
      await submit();
      const req = request('PATCH', '/estates/e1/assets/a1');
      expect(req.request.body).toMatchObject({ location: null, manufacturer: null, supplierId: null, serialNumber: 'SN-1', notes: 'Revisión anual' });
      req.flush({ id: 'a1' });
      await settle();
    });

    it('cambiar de tipo usa el texto del catálogo', async () => {
      await mount(installation());
      type('if-type', 'cubierta', 'change');
      await submit();
      const req = request('PATCH', '/estates/e1/assets/a1');
      expect(req.request.body.category).toBe('Cubierta / tejado');
      req.flush({ id: 'a1' });
      await settle();
    });

    it('una instalación de tipo libre se abre como "Otro" con su texto', async () => {
      await mount(installation({ category: 'Depósito de agua' }));
      expect(field('if-type').value).toBe('otro');
      expect(field('if-other').value).toBe('Depósito de agua');
    });

    it('no envía dos veces si se pulsa mientras guarda', async () => {
      await mount(installation());
      await submit();
      await submit();
      request('PATCH', '/estates/e1/assets/a1').flush({ id: 'a1' });
      await settle();
    });
  });
});
