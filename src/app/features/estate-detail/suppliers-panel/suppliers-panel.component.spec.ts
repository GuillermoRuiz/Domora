import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { SupplierPanelOverview, SupplierPanelRow } from '../../../core/supplier-panel.models';
import { SuppliersPanelComponent } from './suppliers-panel.component';

function supplier(overrides: Partial<SupplierPanelRow> = {}): SupplierPanelRow {
  return {
    id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo', contactName: null, phone: null, email: null,
    displayStatus: 'activo', contract: null, nextVisit: null, openIssues: 0, ...overrides,
  };
}
const contract = (status: 'Activo' | 'PorVencer' | 'Vencido', daysLeft: number | null, serviceType = 'Mantenimiento') =>
  ({ id: 'c', serviceType, status, endDate: null, daysLeft });

describe('SuppliersPanelComponent', () => {
  let h: ComponentHarness<SuppliersPanelComponent>;
  const url = `${API}/estates/e1/suppliers/overview`;

  async function mount(body: SupplierPanelOverview | { status: number }) {
    h = setupComponent(SuppliersPanelComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne(url);
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }
  const kpi = (id: string) => h.el.querySelector(`[data-kpi="${id}"]`) as HTMLElement;
  const text = (id: string) => kpi(id).textContent?.replace(/\s+/g, ' ').trim();
  const rows = () => Array.from(h.el.querySelectorAll('tr[data-supplier]'));
  const names = () => rows().map(r => r.querySelector('.sup-name__title')?.textContent?.trim());
  const set = (id: string, value: string, event = 'input') => {
    const el = h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event(event));
    h.fixture.detectChanges();
  };
  const click = (el: Element) => {
    (el as HTMLElement).click();
    h.fixture.detectChanges();
  };

  afterEach(() => h.http.verify());

  const DATA: SupplierPanelOverview = {
    kpis: { totalSuppliers: 5, activeContracts: 3, expiringContracts: 1, openIssues: 3 },
    recentInterventions: [
      { id: 'iv1', supplierId: 's3', supplierName: 'Limpiezas Costa', supplierCategory: 'Limpieza', purpose: 'Limpieza a fondo', scheduledAt: '2026-10-05T10:00:00.000Z', completedAt: '2026-10-05T12:00:00.000Z', notes: null, asset: null, issue: null },
    ],
    items: [
      supplier({ id: 's1', name: 'Ascensores Levante', category: 'Ascensores', contactName: 'Marta Ruiz', phone: '600 111 222', contract: contract('Activo', 210),
        nextVisit: { id: 'v1', scheduledAt: '2030-03-01T09:30:00.000Z', purpose: 'Revisión mensual' }, openIssues: 2 }),
      supplier({ id: 's2', name: 'Fontanería Ruiz', category: 'Fontanería', contactName: 'Pedro Gil', displayStatus: 'renovar', contract: contract('PorVencer', 12),
        nextVisit: { id: 'v2', scheduledAt: '2030-02-01T09:30:00.000Z', purpose: 'Bajantes' }, openIssues: 1 }),
      supplier({ id: 's3', name: 'Limpiezas Costa', category: 'Limpieza', displayStatus: 'vencido', contract: contract('Vencido', -25) }),
      supplier({ id: 's4', name: 'Jardines Sur', category: 'Jardinería', status: 'Baja', displayStatus: 'baja' }),
      supplier({ id: 's5', name: 'Correduría Credimar', category: 'Seguros', contactName: 'Ana Pons', contract: contract('Activo', 340) }),
    ],
  };

  describe('fichas', () => {
    it('muestran las cifras del resumen', async () => {
      await mount(DATA);
      expect(text('total')).toMatch(/Total proveedores\s?5\s?proveedores/);
      expect(text('contracts')).toMatch(/Contratos activos\s?3\s?contratos vigentes/);
      expect(text('expiring')).toMatch(/Pendientes de renovar\s?1\s?vencen en 30 días/);
      expect(text('issues')).toMatch(/Incidencias abiertas\s?3\s?con proveedor asignado/);
    });

    it('los tonos avisan solo cuando hay algo: renovaciones e incidencias', async () => {
      await mount(DATA);
      expect(kpi('expiring').querySelector('.kpi--warning')).not.toBeNull();
      expect(kpi('issues').querySelector('.kpi--danger')).not.toBeNull();
      await settle();
    });

    it('con todo a cero salen en tono neutro y sin error', async () => {
      await mount({ kpis: { totalSuppliers: 0, activeContracts: 0, expiringContracts: 0, openIssues: 0 }, items: [], recentInterventions: [] });
      for (const id of ['expiring', 'issues']) expect(kpi(id).querySelector('.kpi--default')).not.toBeNull();
      expect(h.el.querySelector('[role="alert"]')).toBeNull();
      expect(h.el.textContent).toContain('Esta finca aún no tiene proveedores.');
    });

    it('si no se puede cargar, lo dice y no muestra cifras', async () => {
      await mount({ status: 500 });
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los proveedores');
      expect(kpi('total')).toBeNull();
    });
  });

  describe('tabla', () => {
    beforeEach(async () => mount(DATA));

    it('lista un proveedor por fila, por nombre, con su categoría', () => {
      expect(names()).toEqual(['Ascensores Levante', 'Correduría Credimar', 'Fontanería Ruiz', 'Jardines Sur', 'Limpiezas Costa']);
      expect(rows()[0].querySelector('.sup-name__sub')?.textContent?.trim()).toBe('Ascensores');
    });

    it('muestra persona de contacto con su teléfono, o un guion si no hay', () => {
      const [levante, , , jardines] = rows();
      expect(levante.querySelector('.sup-contact')?.textContent?.trim()).toBe('Marta Ruiz');
      expect(levante.textContent).toContain('600 111 222');
      expect(jardines.querySelectorAll('td')[1].textContent?.trim()).toBe('—');
    });

    it('muestra la próxima visita con su motivo, o «Sin visitas»', () => {
      const [levante, , , jardines] = rows();
      expect(levante.querySelector('.sup-visit')?.textContent).toMatch(/2030/);
      expect(levante.querySelector('td.td--date .sup-sub')?.textContent).toContain('Revisión mensual');
      expect(jardines.querySelector('td.td--date')?.textContent?.trim()).toBe('Sin visitas');
    });

    it('describe el contrato y lo colorea cuando está por vencer o vencido', () => {
      const by = Object.fromEntries(rows().map(r => [r.querySelector('.sup-name__title')?.textContent?.trim(), r]));
      expect(by['Ascensores Levante'].querySelector('.sup-contract')?.textContent?.trim()).toBe('Vence en 7 meses');
      expect(by['Fontanería Ruiz'].querySelector('.sup-contract--warning')?.textContent?.trim()).toBe('Vence en 12 días');
      expect(by['Limpiezas Costa'].querySelector('.sup-contract--danger')?.textContent?.trim()).toBe('Venció hace 25 días');
      expect(by['Jardines Sur'].querySelector('.sup-contract')?.textContent?.trim()).toBe('Sin contrato');
    });

    it('el estado sale como pill y las incidencias como número (0 en gris)', () => {
      const by = Object.fromEntries(rows().map(r => [r.querySelector('.sup-name__title')?.textContent?.trim(), r]));
      expect(by['Ascensores Levante'].querySelector('app-status-pill')?.textContent?.trim()).toBe('Activo');
      expect(by['Fontanería Ruiz'].querySelector('app-status-pill')?.textContent?.trim()).toBe('Renovar contrato');
      expect(by['Limpiezas Costa'].querySelector('app-status-pill')?.textContent?.trim()).toBe('Contrato vencido');
      expect(by['Jardines Sur'].querySelector('app-status-pill')?.textContent?.trim()).toBe('De baja');
      expect(by['Ascensores Levante'].querySelector('.sup-issues')?.textContent?.trim()).toBe('2');
      expect(by['Jardines Sur'].querySelector('.td--num')?.textContent?.trim()).toBe('0');
    });

    it('pulsar una fila la selecciona; por defecto está seleccionada la primera', () => {
      expect(h.component.selected()?.id).toBe('s1');
      click(rows()[2]);
      expect(h.component.selected()?.id).toBe('s2');
      expect(rows()[2].getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('filtros y orden', () => {
    beforeEach(async () => mount(DATA));

    it('busca por nombre, categoría, contacto, teléfono y sin distinguir tildes', () => {
      set('sup-search', 'fontaneria');
      expect(names()).toEqual(['Fontanería Ruiz']);
      set('sup-search', 'marta');
      expect(names()).toEqual(['Ascensores Levante']);
      set('sup-search', '600 111');
      expect(names()).toEqual(['Ascensores Levante']);
      set('sup-search', 'seguros');
      expect(names()).toEqual(['Correduría Credimar']);
    });

    it('categoría: solo ofrece las que hay y filtra por la elegida', () => {
      expect(Array.from(h.el.querySelectorAll('#sup-category option')).map(o => o.textContent?.trim()))
        .toEqual(['Todas', 'Ascensores', 'Fontanería', 'Limpieza', 'Jardinería', 'Seguros']);
      set('sup-category', 'limpieza', 'change');
      expect(names()).toEqual(['Limpiezas Costa']);
    });

    it('estado: filtra por el estado mostrado', () => {
      set('sup-status', 'baja', 'change');
      expect(names()).toEqual(['Jardines Sur']);
      set('sup-status', 'renovar', 'change');
      expect(names()).toEqual(['Fontanería Ruiz']);
    });

    it('ordena por próxima visita (sin visita al final), contrato que vence antes e incidencias', () => {
      set('sup-sort', 'visit-asc', 'change');
      expect(names()).toEqual(['Fontanería Ruiz', 'Ascensores Levante', 'Correduría Credimar', 'Jardines Sur', 'Limpiezas Costa']);
      set('sup-sort', 'contract-asc', 'change');
      expect(names()).toEqual(['Limpiezas Costa', 'Fontanería Ruiz', 'Ascensores Levante', 'Correduría Credimar', 'Jardines Sur']);
      set('sup-sort', 'issues-desc', 'change');
      expect(names()).toEqual(['Ascensores Levante', 'Fontanería Ruiz', 'Correduría Credimar', 'Jardines Sur', 'Limpiezas Costa']);
      set('sup-sort', 'name-desc', 'change');
      expect(names()).toEqual(['Limpiezas Costa', 'Jardines Sur', 'Fontanería Ruiz', 'Correduría Credimar', 'Ascensores Levante']);
    });

    it('las cabeceras ordenan: un clic en el sentido por defecto y otro lo invierte', () => {
      const header = (field: string) => h.el.querySelector(`[data-sort="${field}"]`) as HTMLElement;
      click(header('issues'));
      expect(names()[0]).toBe('Ascensores Levante');
      expect(header('issues').closest('th')?.getAttribute('aria-sort')).toBe('descending');
      click(header('issues'));
      expect(header('issues').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
      expect(h.el.querySelector('#sup-sort option[value="issues-asc"]')).not.toBeNull();
    });

    it('las fichas filtran (otro clic lo quita) y Total lo limpia todo', () => {
      click(kpi('contracts'));
      expect(names()).toEqual(['Ascensores Levante', 'Correduría Credimar', 'Fontanería Ruiz']);
      expect(kpi('contracts').getAttribute('aria-pressed')).toBe('true');
      click(kpi('contracts'));
      expect(names()).toHaveLength(5);

      click(kpi('expiring'));
      expect(names()).toEqual(['Fontanería Ruiz']);

      click(kpi('total'));
      click(kpi('issues'));
      expect(names()).toEqual(['Ascensores Levante', 'Fontanería Ruiz']);
      expect(h.component.hasFilters()).toBe(true);

      click(kpi('total'));
      expect(names()).toHaveLength(5);
      expect(h.component.hasFilters()).toBe(false);
    });

    it('los filtros se combinan, avisan de cuántos se ven y "Limpiar filtros" los quita sin tocar el orden', () => {
      set('sup-sort', 'name-desc', 'change');
      set('sup-search', 'a');
      set('sup-status', 'activo', 'change');
      expect(names()).toEqual(['Correduría Credimar', 'Ascensores Levante']);
      expect(h.el.querySelector('.panel__count')?.textContent).toContain('Mostrando 2 de 5 proveedores');
      click(h.el.querySelector('.filters__clear') as Element);
      expect(names()).toEqual(['Limpiezas Costa', 'Jardines Sur', 'Fontanería Ruiz', 'Correduría Credimar', 'Ascensores Levante']);
      expect(h.el.querySelector('.filters__clear')).toBeNull();
    });

    it('si ninguno coincide lo dice y ofrece limpiar los filtros', () => {
      set('sup-search', 'zzz');
      expect(names()).toEqual([]);
      expect(h.el.querySelector('.sup-empty')?.textContent).toContain('Ningún proveedor coincide con los filtros.');
    });
  });

  describe('paneles laterales', () => {
    beforeEach(async () => mount(DATA));

    it('«Contacto rápido» enseña al proveedor seleccionado: el primero al principio y el pulsado después', () => {
      const person = () => h.el.querySelector('app-supplier-quick-contact .contact__person')?.textContent?.trim();
      expect(person()).toBe('Marta Ruiz');
      click(rows()[2]);
      expect(person()).toBe('Pedro Gil');
    });

    it('al filtrar, «Contacto rápido» pasa al primero de lo que queda', () => {
      set('sup-search', 'jardines');
      expect(h.el.querySelector('app-supplier-quick-contact .contact__company')?.textContent).toContain('Jardines Sur');
    });

    it('«Últimas intervenciones» lista lo que trae el resumen', () => {
      expect(h.el.querySelectorAll('app-supplier-interventions [data-intervention]')).toHaveLength(1);
      expect(h.el.querySelector('app-supplier-interventions')?.textContent).toContain('Limpieza a fondo');
    });

    it('pulsar una intervención selecciona a su proveedor y, si los filtros lo ocultaban, los quita', () => {
      set('sup-search', 'ascensores');
      expect(names()).toEqual(['Ascensores Levante']);
      click(h.el.querySelector('[data-intervention="iv1"]') as Element);
      expect(h.component.hasFilters()).toBe(false);
      expect(h.component.selected()?.id).toBe('s3');
      expect(h.el.querySelector('app-supplier-quick-contact .contact__company')?.textContent).toContain('Limpiezas Costa');
    });

    it('pulsar una intervención de un proveedor visible no toca los filtros', () => {
      set('sup-search', 'limpiezas');
      click(h.el.querySelector('[data-intervention="iv1"]') as Element);
      expect(h.component.hasFilters()).toBe(true);
      expect(h.component.selected()?.id).toBe('s3');
    });
  });

  describe('acciones', () => {
    beforeEach(async () => mount(DATA));

    const menuButton = (id: string) => h.el.querySelector(`[data-supplier="${id}"] .action-btn`) as HTMLElement;
    const menuItem = (action: string) => h.el.querySelector(`.sup-menu [data-action="${action}"]`) as HTMLElement | null;
    const reloadWith = async (body: SupplierPanelOverview) => {
      h.http.expectOne(url).flush(body);
      await settle();
      h.fixture.detectChanges();
    };

    it('cada fila tiene su menú, que se abre y se cierra', () => {
      expect(h.el.querySelector('.sup-menu')).toBeNull();
      click(menuButton('s1'));
      expect(menuItem('edit')).not.toBeNull();
      click(h.el.querySelector('.menu-backdrop') as Element);
      expect(h.el.querySelector('.sup-menu')).toBeNull();
    });

    it('el menú de un proveedor activo ofrece «Dar de baja» y el de uno de baja «Reactivar»', () => {
      click(menuButton('s1'));
      expect(menuItem('toggle-active')?.textContent).toContain('Dar de baja');
      click(h.el.querySelector('.menu-backdrop') as Element);
      click(menuButton('s4'));
      expect(menuItem('toggle-active')?.textContent).toContain('Reactivar');
    });

    it('«Nuevo proveedor» abre el formulario de alta', () => {
      click(h.el.querySelector('[data-action="new"]') as Element);
      expect(h.el.querySelector('app-supplier-form-modal h4')?.textContent).toContain('Nuevo proveedor');
    });

    it('«Editar proveedor» abre el formulario con el proveedor elegido', async () => {
      click(menuButton('s2'));
      click(menuItem('edit') as Element);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-supplier-form-modal h4')?.textContent).toContain('Editar proveedor');
      expect((h.el.querySelector('#sf-name') as HTMLInputElement).value).toBe('Fontanería Ruiz');
      expect(h.el.querySelector('.sup-menu')).toBeNull();
    });

    it('al guardar el formulario se cierra y el panel recarga los datos', async () => {
      click(h.el.querySelector('[data-action="new"]') as Element);
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelector('#sf-name') as HTMLInputElement).value = 'Nuevo S.L.';
      (h.el.querySelector('#sf-name') as HTMLInputElement).dispatchEvent(new Event('input'));
      (h.el.querySelector('app-supplier-form-modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle();
      h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/estates/e1/suppliers`).flush({ id: 's9' });
      await settle();
      await reloadWith({ ...DATA, kpis: { ...DATA.kpis, totalSuppliers: 6 } });
      expect(h.el.querySelector('app-supplier-form-modal')).toBeNull();
      expect(text('total')).toMatch(/Total proveedores\s?6/);
    });

    it('«Dar de baja» cambia el estado en el servidor y recarga', async () => {
      click(menuButton('s1'));
      click(menuItem('toggle-active') as Element);
      await settle();
      const req = h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/estates/e1/suppliers/s1`);
      expect(req.request.body).toEqual({ status: 'Baja' });
      req.flush({});
      await settle();
      await reloadWith({ ...DATA, items: DATA.items.map(i => (i.id === 's1' ? { ...i, status: 'Baja', displayStatus: 'baja' as const } : i)) });
      expect(h.el.querySelector('[data-supplier="s1"] app-status-pill')?.textContent?.trim()).toBe('De baja');
    });

    it('«Reactivar» devuelve un proveedor de baja a activo', async () => {
      click(menuButton('s4'));
      click(menuItem('toggle-active') as Element);
      await settle();
      const req = h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/estates/e1/suppliers/s4`);
      expect(req.request.body).toEqual({ status: 'Activo' });
      req.flush({});
      await settle();
      h.http.expectOne(url).flush(DATA);
      await settle();
    });

    it('si el cambio de estado falla, lo dice con el nombre del proveedor y deja los datos como estaban', async () => {
      click(menuButton('s1'));
      click(menuItem('toggle-active') as Element);
      await settle();
      h.http.expectOne((r) => r.method === 'PATCH').flush({ message: 'x' }, { status: 500, statusText: 'Error' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo dar de baja a "Ascensores Levante"');
      expect(names()).toHaveLength(5);
    });
  });

  describe('visitas', () => {
    beforeEach(async () => mount(DATA));

    const menuButton = (id: string) => h.el.querySelector(`[data-supplier="${id}"] .action-btn`) as HTMLElement;
    const visitsUrl = `${API}/estates/e1/suppliers/s2/visits`;

    it('el menú ofrece programar una visita y ver las del proveedor', () => {
      click(menuButton('s2'));
      expect(h.el.querySelector('.sup-menu [data-action="schedule"]')?.textContent).toContain('Programar visita');
      expect(h.el.querySelector('.sup-menu [data-action="visits"]')?.textContent).toContain('Ver visitas');
    });

    it('«Ver visitas» abre el modal con la lista del proveedor elegido', async () => {
      click(menuButton('s2'));
      click(h.el.querySelector('.sup-menu [data-action="visits"]') as Element);
      h.http.expectOne(visitsUrl).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-supplier-visits-modal h4')?.textContent).toContain('Visitas');
      expect(h.el.querySelector('app-supplier-visits-modal .modal__subtitle')?.textContent).toContain('Fontanería Ruiz');
      expect(h.el.querySelector('.sup-menu')).toBeNull();
    });

    it('«Programar visita» abre el modal directamente en el formulario', async () => {
      click(menuButton('s2'));
      click(h.el.querySelector('.sup-menu [data-action="schedule"]') as Element);
      h.http.expectOne(`${API}/estates/e1/installations`).flush({ items: [], upcoming: [] });
      h.http.expectOne(visitsUrl).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-supplier-visits-modal h4')?.textContent).toContain('Programar visita');
    });

    it('un cambio en el modal recarga el panel sin cerrarlo, y cerrar lo quita', async () => {
      click(menuButton('s2'));
      click(h.el.querySelector('.sup-menu [data-action="visits"]') as Element);
      h.http.expectOne(visitsUrl).flush([
        { id: 'v1', supplierId: 's2', estateId: 'e1', scheduledAt: '2030-02-01T09:30:00.000Z', purpose: 'Bajantes', status: 'planificada', notes: null, completedAt: null, cancelledAt: null, asset: null, issue: null },
      ]);
      await settle();
      h.fixture.detectChanges();

      click(h.el.querySelector('app-supplier-visits-modal [data-action="complete"]') as Element);
      click(h.el.querySelector('app-supplier-visits-modal [data-action="confirm-close"] button') as Element);
      h.http.expectOne((r) => r.method === 'POST' && r.url === `${visitsUrl}/v1/complete`).flush({});
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === visitsUrl).flush([]);
      await settle();
      h.http.expectOne(url).flush({ ...DATA, recentInterventions: [] }); // el panel se actualiza
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-supplier-visits-modal')).not.toBeNull();

      click(h.el.querySelector('app-supplier-visits-modal .close-btn') as Element);
      expect(h.el.querySelector('app-supplier-visits-modal')).toBeNull();
    });
  });
});
