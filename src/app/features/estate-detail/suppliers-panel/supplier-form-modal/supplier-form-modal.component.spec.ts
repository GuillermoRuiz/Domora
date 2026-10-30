import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import type { SupplierPanelRow } from '../../../../core/supplier-panel.models';
import { SupplierFormModalComponent } from './supplier-form-modal.component';

function supplier(overrides: Partial<SupplierPanelRow> = {}): SupplierPanelRow {
  return {
    id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo', contactName: 'Marta Ruiz', phone: '96 341 09 77',
    email: 'marta@levante.test', displayStatus: 'activo', contract: null, nextVisit: null, openIssues: 0, ...overrides,
  };
}

describe('SupplierFormModalComponent', () => {
  let h: ComponentHarness<SupplierFormModalComponent>;

  /** ngModel dentro de un formulario registra sus controles en un microtask: hay que esperarlo antes de escribir o leer. */
  async function mount(target: SupplierPanelRow | null = null): Promise<void> {
    h = setupComponent(SupplierFormModalComponent);
    h.component.estateId = 'e1';
    h.component.supplier = target;
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }
  const field = (id: string) => h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
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

    it('título, botón y categoría por defecto de un proveedor nuevo', () => {
      expect(h.el.querySelector('h4')?.textContent).toContain('Nuevo proveedor');
      expect(h.el.querySelector('[type="submit"]')?.textContent).toContain('Crear proveedor');
      expect(field('sf-category').value).toBe('ascensores');
    });

    it('sin nombre no envía nada y lo marca', async () => {
      await submit();
      h.http.expectNone((r) => r.method === 'POST');
      expect(h.el.querySelector('.field-error')?.textContent).toContain('El nombre es obligatorio');
    });

    it('un correo mal escrito no se envía y lo avisa', async () => {
      type('sf-name', 'Fontanería Ruiz');
      type('sf-email', 'no-es-un-correo');
      await submit();
      h.http.expectNone((r) => r.method === 'POST');
      expect(h.el.querySelector('.field-error')?.textContent).toContain('El correo no es válido');
    });

    it('crea el proveedor con su categoría y solo los datos de contacto rellenados', async () => {
      type('sf-name', '  Fontanería Ruiz  ');
      type('sf-category', 'fontaneria', 'change');
      type('sf-contact', 'Pedro Gil');
      await submit();
      const req = request('POST', '/estates/e1/suppliers');
      expect(req.request.body).toEqual({ name: 'Fontanería Ruiz', category: 'Fontanería', contactName: 'Pedro Gil' });
      req.flush({ id: 's9', name: 'Fontanería Ruiz' });
      await settle();
      expect(h.component.saving()).toBe(false);
    });

    it('avisa al panel de que se guardó', async () => {
      let saved = 0;
      h.component.saved.subscribe(() => saved++);
      type('sf-name', 'Jardines Sur');
      await submit();
      request('POST', '/estates/e1/suppliers').flush({ id: 's9' });
      await settle();
      expect(saved).toBe(1);
    });

    it('«Otro» deja escribir una categoría libre; vacía se guarda como "Otro"', async () => {
      type('sf-name', 'Administración Sol');
      type('sf-category', 'otro', 'change');
      await settle();
      h.fixture.detectChanges();
      type('sf-other', 'Administración de fincas');
      await submit();
      const req = request('POST', '/estates/e1/suppliers');
      expect(req.request.body.category).toBe('Administración de fincas');
      req.flush({ id: 's9' });
      await settle();
    });

    it('si el servidor rechaza el alta, enseña su mensaje y no cierra', async () => {
      let saved = 0;
      h.component.saved.subscribe(() => saved++);
      type('sf-name', 'Jardines Sur');
      await submit();
      request('POST', '/estates/e1/suppliers').flush({ message: 'Ya existe un proveedor con ese nombre.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('Ya existe un proveedor con ese nombre.');
      expect(saved).toBe(0);
      expect(h.component.saving()).toBe(false);
    });
  });

  describe('edición', () => {
    it('rellena el formulario con los datos del proveedor y conserva su texto de categoría', async () => {
      await mount(supplier({ category: 'Ascensores y elevadores' }));
      expect(h.el.querySelector('h4')?.textContent).toContain('Editar proveedor');
      expect(h.el.querySelector('[type="submit"]')?.textContent).toContain('Guardar cambios');
      expect(field('sf-name').value).toBe('Ascensores Levante');
      expect(field('sf-category').value).toBe('ascensores');
      expect(field('sf-contact').value).toBe('Marta Ruiz');
      expect(field('sf-phone').value).toBe('96 341 09 77');
      expect(field('sf-email').value).toBe('marta@levante.test');
    });

    it('envía solo lo que cambia: cambiar el teléfono no toca nada más (ni la categoría)', async () => {
      await mount(supplier({ category: 'Ascensores y elevadores' }));
      type('sf-phone', '600 000 000');
      await submit();
      const req = request('PATCH', '/estates/e1/suppliers/s1');
      expect(req.request.body).toEqual({ phone: '600 000 000' });
      req.flush({});
      await settle();
    });

    it('un contacto vaciado se envía como null para borrarlo', async () => {
      await mount(supplier());
      type('sf-contact', '');
      type('sf-email', '');
      await submit();
      const req = request('PATCH', '/estates/e1/suppliers/s1');
      expect(req.request.body).toEqual({ contactName: null, email: null });
      req.flush({});
      await settle();
    });

    it('sin cambios no llama al servidor pero sí cierra el trabajo (avisa de guardado)', async () => {
      await mount(supplier());
      let saved = 0;
      h.component.saved.subscribe(() => saved++);
      await submit();
      h.http.expectNone((r) => r.method === 'PATCH');
      expect(saved).toBe(1);
    });

    it('cambiar de categoría envía la etiqueta del catálogo', async () => {
      await mount(supplier());
      type('sf-category', 'limpieza', 'change');
      await submit();
      const req = request('PATCH', '/estates/e1/suppliers/s1');
      expect(req.request.body).toEqual({ category: 'Limpieza' });
      req.flush({});
      await settle();
    });
  });
});
