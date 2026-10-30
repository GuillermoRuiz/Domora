import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateInstallations, Installation } from '../../../core/installations.models';
import { InstallationsPanelComponent } from './installations-panel.component';

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'a1', name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', manufacturer: null, serialNumber: null, notes: null,
    operationalStatus: 'operativa', displayStatus: 'operativa', supplier: null,
    lastReviewDate: null, nextReviewDate: null, nextReviewDaysLeft: null, openIssues: 0, ...overrides,
  };
}

describe('InstallationsPanelComponent', () => {
  let h: ComponentHarness<InstallationsPanelComponent>;
  const url = `${API}/estates/e1/installations`;

  async function mount(body: EstateInstallations | { status: number }) {
    h = setupComponent(InstallationsPanelComponent);
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

  afterEach(() => h.http.verify());

  const DATA: EstateInstallations = {
    upcoming: [],
    items: [
      installation({ id: 'a1', name: 'Ascensor A', nextReviewDaysLeft: 270, openIssues: 0 }),
      installation({ id: 'a2', name: 'Ascensor B', nextReviewDaysLeft: 240, openIssues: 1 }),
      installation({ id: 'a3', name: 'Caldera', displayStatus: 'revision_proxima', nextReviewDaysLeft: 3 }),
      installation({ id: 'a4', name: 'PCI', displayStatus: 'revision_proxima', nextReviewDaysLeft: 30, openIssues: 1 }),
      installation({ id: 'a5', name: 'Piscina', operationalStatus: 'en_mantenimiento', displayStatus: 'en_mantenimiento', nextReviewDaysLeft: 60, openIssues: 2 }),
      installation({ id: 'a6', name: 'Cubierta', displayStatus: 'revision_vencida', nextReviewDaysLeft: -20 }),
      installation({ id: 'a7', name: 'CCTV' }),
    ],
  };

  it('cuenta el total, las que están en mantenimiento y las incidencias abiertas vinculadas', async () => {
    await mount(DATA);
    expect(text('total')).toMatch(/Total instalaciones\s?7\s?instalaciones/);
    expect(text('maintenance')).toMatch(/En mantenimiento\s?1\s?instalaciones/);
    expect(text('issues')).toMatch(/Incidencias relacionadas\s?4\s?incidencias abiertas/);
  });

  it('revisión próxima = de hoy a 30 días (incluido el 30); las vencidas no cuentan pero se mencionan', async () => {
    await mount(DATA);
    expect(h.component.kpis().soon).toBe(2); // 3 y 30 días
    expect(text('soon')).toMatch(/Revisión próxima\s?2\s?próximos 30 días · 1 vencida/);
  });

  it('sin vencidas el texto es "en los próximos 30 días"', async () => {
    await mount({ upcoming: [], items: [installation({ nextReviewDaysLeft: 5 })] });
    expect(text('soon')).toMatch(/1\s?en los próximos 30 días$/);
  });

  it('los tonos avisan solo cuando hay algo: mantenimiento, revisión y incidencias', async () => {
    await mount(DATA);
    expect(kpi('maintenance').querySelector('.kpi--positive')).not.toBeNull();
    expect(kpi('soon').querySelector('.kpi--warning')).not.toBeNull();
    expect(kpi('issues').querySelector('.kpi--danger')).not.toBeNull();
  });

  it('con instalaciones sin nada pendiente todas las cifras salen a cero y en tono neutro', async () => {
    await mount({ upcoming: [], items: [installation({ nextReviewDaysLeft: 200 })] });
    expect(h.component.kpis()).toMatchObject({ total: 1, maintenance: 0, soon: 0, overdue: 0, issues: 0 });
    for (const id of ['maintenance', 'soon', 'issues']) expect(kpi(id).querySelector('.kpi--default')).not.toBeNull();
  });

  it('una finca sin instalaciones muestra ceros, no un error', async () => {
    await mount({ upcoming: [], items: [] });
    expect(text('total')).toMatch(/Total instalaciones\s?0/);
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('mientras carga lo dice, y si falla muestra un aviso', async () => {
    h = setupComponent(InstallationsPanelComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.http.expectOne(url).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });

  describe('filtros y orden', () => {
    const SUP_A = { id: 's1', name: 'Ascensores Levante' };
    const SUP_B = { id: 's2', name: 'Calefacciones Turia' };
    const FILTERED: EstateInstallations = {
      upcoming: [],
      items: [
        installation({ id: 'a1', name: 'Ascensor 10', category: 'Ascensor', location: 'Portal 1', supplier: SUP_A, nextReviewDate: '2027-03-01', nextReviewDaysLeft: 200, lastReviewDate: '2026-03-01', openIssues: 0 }),
        installation({ id: 'a2', name: 'Ascensor 2', category: 'Ascensores', location: 'Portal 2', supplier: SUP_A, nextReviewDate: '2026-10-20', nextReviewDaysLeft: 4, displayStatus: 'revision_proxima', lastReviewDate: '2026-01-10', openIssues: 1 }),
        installation({ id: 'a3', name: 'Caldera', category: 'Calefacción / ACS', location: 'Sala de calderas', supplier: SUP_B, nextReviewDate: '2026-12-01', nextReviewDaysLeft: 60, lastReviewDate: null, openIssues: 0 }),
        installation({ id: 'a4', name: 'Piscina', category: 'Piscina', location: 'Zona exterior', supplier: null, operationalStatus: 'en_mantenimiento', displayStatus: 'en_mantenimiento', nextReviewDate: null, nextReviewDaysLeft: null, lastReviewDate: '2026-08-01', openIssues: 2 }),
        installation({ id: 'a5', name: 'Cubierta', category: 'Cubierta', location: 'Azotea', supplier: null, displayStatus: 'revision_vencida', nextReviewDate: '2026-09-25', nextReviewDaysLeft: -21, lastReviewDate: '2016-09-01' }),
      ],
    };
    const names = () => h.component.visible().map(i => i.name);
    const set = (id: string, value: string, event = 'input') => {
      const el = h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
      el.value = value;
      el.dispatchEvent(new Event(event));
      h.fixture.detectChanges();
    };

    beforeEach(async () => {
      await mount(FILTERED);
    });

    it('por defecto muestra todas, ordenadas por nombre (con números naturales) y dice cuántas', () => {
      expect(names()).toEqual(['Ascensor 2', 'Ascensor 10', 'Caldera', 'Cubierta', 'Piscina']);
      expect(h.el.querySelector('.panel__count')).toBeNull(); // sin filtros no hace falta contar
    });

    it('busca por nombre, ubicación, tipo o proveedor, sin tildes ni mayúsculas', () => {
      set('inst-search', 'CALEFACCION');
      expect(names()).toEqual(['Caldera']);
      set('inst-search', 'portal');
      expect(names()).toEqual(['Ascensor 2', 'Ascensor 10']);
      set('inst-search', 'turia');
      expect(names()).toEqual(['Caldera']);
      set('inst-search', 'zzz');
      expect(names()).toEqual([]);
      expect(h.el.querySelector('.inst-empty')?.textContent).toContain('Ninguna instalación coincide');
    });

    it('el desplegable Tipo solo ofrece los tipos que hay, y agrupa textos distintos del mismo tipo', () => {
      expect(Array.from(h.el.querySelectorAll('#inst-type option')).map(o => o.textContent?.trim())).toEqual(['Todos', 'Ascensor', 'Calefacción / ACS', 'Piscina', 'Cubierta / tejado']);
      set('inst-type', 'ascensor', 'change'); // "Ascensor" y "Ascensores" son el mismo tipo
      expect(names()).toEqual(['Ascensor 2', 'Ascensor 10']);
    });

    it('filtra por el estado a mostrar', () => {
      set('inst-status', 'revision_vencida', 'change');
      expect(names()).toEqual(['Cubierta']);
      set('inst-status', 'en_mantenimiento', 'change');
      expect(names()).toEqual(['Piscina']);
    });

    it('próximas revisiones: 30 días, 90 días y vencidas (las que no tienen fecha quedan fuera)', () => {
      set('inst-review', 'soon', 'change');
      expect(names()).toEqual(['Ascensor 2']);
      set('inst-review', 'quarter', 'change');
      expect(names()).toEqual(['Ascensor 2', 'Caldera']);
      set('inst-review', 'overdue', 'change');
      expect(names()).toEqual(['Cubierta']);
    });

    it('proveedor: uno concreto o "Sin proveedor", con la lista ordenada', () => {
      expect(Array.from(h.el.querySelectorAll('#inst-supplier option')).map(o => o.textContent?.trim())).toEqual(['Todos', 'Ascensores Levante', 'Calefacciones Turia', 'Sin proveedor']);
      set('inst-supplier', 's1', 'change');
      expect(names()).toEqual(['Ascensor 2', 'Ascensor 10']);
      set('inst-supplier', 'none', 'change');
      expect(names()).toEqual(['Cubierta', 'Piscina']);
    });

    it('ordena por próxima revisión (sin fecha al final), última revisión (sin fecha al final) e incidencias', () => {
      set('inst-sort', 'next-asc', 'change');
      expect(names()).toEqual(['Cubierta', 'Ascensor 2', 'Caldera', 'Ascensor 10', 'Piscina']);
      set('inst-sort', 'last-desc', 'change');
      expect(names()).toEqual(['Piscina', 'Ascensor 10', 'Ascensor 2', 'Cubierta', 'Caldera']);
      set('inst-sort', 'issues-desc', 'change');
      expect(names()).toEqual(['Piscina', 'Ascensor 2', 'Ascensor 10', 'Caldera', 'Cubierta']);
      set('inst-sort', 'name-desc', 'change');
      expect(names()).toEqual(['Piscina', 'Cubierta', 'Caldera', 'Ascensor 10', 'Ascensor 2']);
    });

    it('las fichas filtran: mantenimiento, revisión próxima e incidencias (otro clic lo quita) y Total lo limpia todo', () => {
      (kpi('maintenance') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toEqual(['Piscina']);
      expect(kpi('maintenance').getAttribute('aria-pressed')).toBe('true');
      (kpi('maintenance') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toHaveLength(5);

      (kpi('soon') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toEqual(['Ascensor 2']);

      (kpi('total') as HTMLButtonElement).click();
      (kpi('issues') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toEqual(['Ascensor 2', 'Piscina']);
      expect(h.component.hasFilters()).toBe(true);

      (kpi('total') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toHaveLength(5);
      expect(h.component.hasFilters()).toBe(false);
    });

    it('los filtros se combinan y "Limpiar filtros" los quita (no toca el orden)', () => {
      set('inst-sort', 'name-desc', 'change');
      set('inst-type', 'ascensor', 'change');
      set('inst-review', 'soon', 'change');
      expect(names()).toEqual(['Ascensor 2']);
      (h.el.querySelector('.filters__clear') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(names()).toEqual(['Piscina', 'Cubierta', 'Caldera', 'Ascensor 10', 'Ascensor 2']);
      expect(h.el.querySelector('.filters__clear')).toBeNull();
    });
  });

  describe('tabla', () => {
    const SUP = { id: 's1', name: 'Ascensores Levante' };
    const TABLE: EstateInstallations = {
      upcoming: [],
      items: [
        installation({ id: 'a1', name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', supplier: SUP, lastReviewDate: '2026-01-15', nextReviewDate: '2027-01-15', nextReviewDaysLeft: 270, openIssues: 0 }),
        installation({ id: 'a2', name: 'Caldera', category: 'Calefacción / ACS', location: 'Sala de calderas', displayStatus: 'revision_proxima', lastReviewDate: '2025-10-10', nextReviewDate: '2026-10-19', nextReviewDaysLeft: 3, openIssues: 2 }),
        installation({ id: 'a3', name: 'Cubierta', category: 'Cubierta', location: null, displayStatus: 'revision_vencida', lastReviewDate: null, nextReviewDate: '2026-09-25', nextReviewDaysLeft: -20, openIssues: 1 }),
        installation({ id: 'a4', name: 'Piscina', category: 'Piscina', location: 'Zona exterior', operationalStatus: 'en_mantenimiento', displayStatus: 'en_mantenimiento', nextReviewDate: null, nextReviewDaysLeft: null }),
      ],
    };
    const rowIds = () => Array.from(h.el.querySelectorAll('[data-installation]')).map(r => r.getAttribute('data-installation'));
    const cell = (id: string, i: number) => h.el.querySelector(`[data-installation="${id}"]`)!.querySelectorAll('td')[i].textContent?.replace(/\s+/g, ' ').trim();
    const header = (field: string) => h.el.querySelector(`[data-sort="${field}"]`) as HTMLButtonElement;

    beforeEach(async () => {
      await mount(TABLE);
    });

    it('columnas: Instalación, Ubicación, Estado, Última y Próxima revisión, Proveedor, Incidencias y Acción', () => {
      expect(Array.from(h.el.querySelectorAll('.inst-table thead th')).map(th => th.textContent?.replace(/\s+/g, ' ').trim()))
        .toEqual(['Instalación', 'Ubicación', 'Estado', 'Última revisión', 'Próxima revisión', 'Proveedor', 'Incidencias', 'Acción']);
    });

    it('cada fila muestra nombre, tipo, ubicación, estado, fechas con su plazo, proveedor e incidencias', () => {
      expect(h.el.querySelector('[data-installation="a1"] .inst-name__title')?.textContent).toBe('Ascensor A');
      expect(h.el.querySelector('[data-installation="a1"] .inst-name__sub')?.textContent).toBe('Ascensor');
      expect(cell('a1', 1)).toBe('Portal 1');
      expect(cell('a1', 2)).toBe('Operativa');
      expect(cell('a1', 3)).toMatch(/^15 ene\.? 2026$/);
      expect(cell('a1', 4)).toMatch(/^15 ene\.? 2027\s?\(en 9 meses\)$/);
      expect(cell('a1', 5)).toBe('Ascensores Levante');
      expect(cell('a1', 6)).toBe('0');
      expect(cell('a2', 2)).toBe('Revisión próxima');
      expect(cell('a2', 4)).toMatch(/\(en 3 días\)$/);
      expect(cell('a2', 6)).toBe('2');
    });

    it('lo que falta se muestra con guion y sin plazo', () => {
      expect(cell('a3', 1)).toBe('—'); // sin ubicación
      expect(cell('a3', 3)).toBe('—'); // sin última revisión
      expect(cell('a3', 5)).toBe('—'); // sin proveedor
      expect(cell('a4', 4)).toBe('—'); // sin próxima revisión: ni fecha ni plazo
      expect(h.el.querySelector('[data-installation="a4"] .inst-next__sub')).toBeNull();
    });

    it('la próxima revisión se resalta si está al caer (aviso) o ya venció (peligro)', () => {
      expect(h.el.querySelector('[data-installation="a2"] .inst-next--warning')).not.toBeNull();
      expect(h.el.querySelector('[data-installation="a3"] .inst-next--danger')).not.toBeNull();
      expect(cell('a3', 4)).toMatch(/\(hace 20 días\)$/);
      expect(h.el.querySelector('[data-installation="a1"] .inst-next--warning, [data-installation="a1"] .inst-next--danger')).toBeNull();
    });

    it('el tipo tiene icono y las incidencias llevan punto rojo solo si hay', () => {
      expect(h.el.querySelectorAll('[data-installation] .inst-icon app-icon')).toHaveLength(4);
      expect(h.el.querySelector('[data-installation="a2"] .inst-issues__dot')).not.toBeNull();
      expect(h.el.querySelector('[data-installation="a1"] .inst-issues__dot')).toBeNull();
    });

    it('las cabeceras ordenan: Instalación empieza en A-Z y el segundo clic lo invierte (aria-sort)', () => {
      const th = (field: string) => header(field).closest('th')!;
      expect(th('name').getAttribute('aria-sort')).toBe('ascending');
      expect(th('location').getAttribute('aria-sort')).toBe('none');
      header('name').click();
      h.fixture.detectChanges();
      expect(th('name').getAttribute('aria-sort')).toBe('descending');
      expect(rowIds()).toEqual(['a4', 'a3', 'a2', 'a1']);
    });

    it('ubicación y proveedor ordenan con lo que no tiene dato siempre al final', () => {
      header('location').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a1', 'a2', 'a4', 'a3']); // Portal 1, Sala…, Zona…, (sin ubicación)
      header('location').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a4', 'a2', 'a1', 'a3']);
      header('supplier').click();
      h.fixture.detectChanges();
      expect(rowIds()[0]).toBe('a1');
      expect(rowIds().slice(1)).toEqual(['a2', 'a3', 'a4']); // sin proveedor, por nombre
    });

    it('estado: lo que pide atención sube primero (vencida, próxima, mantenimiento, operativa)', () => {
      header('status').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a3', 'a2', 'a4', 'a1']);
    });

    it('fechas: la próxima empieza por la más cercana y la última por la más reciente; incidencias por las que más tienen', () => {
      header('next').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a3', 'a2', 'a1', 'a4']);
      header('last').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a1', 'a2', 'a3', 'a4']); // 2026-01, 2025-10, sin fecha, sin fecha
      header('issues').click();
      h.fixture.detectChanges();
      expect(rowIds()).toEqual(['a2', 'a3', 'a1', 'a4']);
    });

    it('si una cabecera elige un orden que no está en el desplegable, este lo muestra', async () => {
      header('location').click();
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      const select = h.el.querySelector('#inst-sort') as HTMLSelectElement;
      expect(select.options[select.selectedIndex].textContent?.trim()).toBe('Ubicación ↑');
      expect(select.options).toHaveLength(6);
      select.value = 'name-asc';
      select.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('#inst-sort')!.querySelectorAll('option')).toHaveLength(5);
    });

    it('con filtros activos dice cuántas se ven; sin coincidencias lo dice y ofrece limpiar', () => {
      expect(h.el.querySelector('.panel__count')).toBeNull();
      const search = h.el.querySelector('#inst-search') as HTMLInputElement;
      search.value = 'cald';
      search.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      expect(h.el.querySelector('.panel__count')?.textContent?.trim()).toBe('Mostrando 1 de 4 instalaciones');
      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      expect(h.el.querySelector('.inst-empty')?.textContent).toContain('Ninguna instalación coincide');
      (h.el.querySelector('.inst-empty .filters__clear') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(rowIds()).toHaveLength(4);
    });
  });

  describe('menú de acción', () => {
    const DATA: EstateInstallations = {
      upcoming: [],
      items: [installation({ id: 'a1', name: 'Ascensor A' }), installation({ id: 'a2', name: 'Piscina', operationalStatus: 'en_mantenimiento', displayStatus: 'en_mantenimiento' })],
    };
    const open = (id: string) => {
      (h.el.querySelector(`[data-installation="${id}"] .action-btn`) as HTMLButtonElement).click();
      h.fixture.detectChanges();
    };
    const menu = () => h.el.querySelector('.inst-menu');
    const statusCall = () => h.http.expectOne((r) => r.method === 'PATCH');

    beforeEach(async () => {
      await mount(DATA);
    });

    it('se abre junto a su fila con "Registrar revisión" y los tres estados, marcando el actual', () => {
      open('a2');
      expect(menu()).not.toBeNull();
      expect(menu()!.querySelector('[data-action="review"]')?.textContent).toContain('Registrar revisión');
      expect(Array.from(menu()!.querySelectorAll('[data-status]')).map(b => b.textContent?.trim())).toEqual(['Operativa', 'En mantenimiento', 'Fuera de servicio']);
      expect(menu()!.querySelector('[data-status="en_mantenimiento"]')?.getAttribute('aria-checked')).toBe('true');
      expect(menu()!.querySelector('[data-status="operativa"]')?.getAttribute('aria-checked')).toBe('false');
      expect(h.el.querySelector('[data-installation="a2"] .action-btn')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('otro clic en el botón, el fondo o Escape lo cierran', () => {
      open('a1');
      open('a1');
      expect(menu()).toBeNull();
      open('a1');
      (h.el.querySelector('.menu-backdrop') as HTMLElement).click();
      h.fixture.detectChanges();
      expect(menu()).toBeNull();
      open('a1');
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      h.fixture.detectChanges();
      expect(menu()).toBeNull();
    });

    it('"Registrar revisión" cierra el menú y avisa para ir a Inspecciones', () => {
      const opened = vi.fn();
      h.component.openInspections.subscribe(opened);
      open('a1');
      (menu()!.querySelector('[data-action="review"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(opened).toHaveBeenCalledTimes(1);
      expect(menu()).toBeNull();
    });

    it('cambiar el estado hace PATCH solo con el estado y recarga el panel (las fichas se actualizan)', async () => {
      open('a1');
      (menu()!.querySelector('[data-status="en_mantenimiento"]') as HTMLButtonElement).click();
      const patch = statusCall();
      expect(patch.request.url).toBe(`${API}/estates/e1/assets/a1`);
      expect(patch.request.body).toEqual({ operationalStatus: 'en_mantenimiento' });
      patch.flush({ id: 'a1' });
      await settle();
      h.http.expectOne(url).flush({ upcoming: [], items: [installation({ id: 'a1', name: 'Ascensor A', operationalStatus: 'en_mantenimiento', displayStatus: 'en_mantenimiento' }), DATA.items[1]] });
      await settle();
      h.fixture.detectChanges();
      expect(h.component.kpis().maintenance).toBe(2);
      expect(h.el.querySelector('[data-installation="a1"] app-status-pill')?.textContent).toContain('En mantenimiento');
      expect(menu()).toBeNull();
    });

    it('elegir el estado que ya tiene no hace ninguna petición', () => {
      open('a2');
      (menu()!.querySelector('[data-status="en_mantenimiento"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectNone((r) => r.method === 'PATCH');
      expect(menu()).toBeNull();
    });

    it('si falla el cambio avisa y conserva la tabla', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      open('a1');
      (menu()!.querySelector('[data-status="fuera_de_servicio"]') as HTMLButtonElement).click();
      statusCall().flush({ message: 'x' }, { status: 500, statusText: 'Error' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cambiar el estado de "Ascensor A"');
      expect(h.el.querySelectorAll('[data-installation]')).toHaveLength(2);
    });
  });

  it('una finca sin instalaciones lo dice (no una tabla vacía)', async () => {
    await mount({ upcoming: [], items: [] });
    expect(h.el.textContent).toContain('aún no tiene instalaciones');
    expect(h.el.querySelector('.inst-table')).toBeNull();
    expect(h.el.querySelector('[data-action="new"]')).not.toBeNull(); // se puede dar de alta la primera
  });

  describe('ficha, alta y edición', () => {
    const ITEMS: EstateInstallations = {
      upcoming: [],
      items: [
        installation({ id: 'a1', name: 'Ascensor A', category: 'Ascensor', supplier: { id: 's1', name: 'Ascensores Levante' } }),
        installation({ id: 'a2', name: 'Piscina', category: 'Piscina' }),
      ],
    };
    const suppliersUrl = `${API}/estates/e1/suppliers`;
    const flushSuppliers = async (body: unknown[] = [{ id: 's1', name: 'Ascensores Levante', status: 'Activo' }, { id: 's3', name: 'De baja', status: 'Baja' }]) => {
      h.http.expectOne(suppliersUrl).flush(body);
      await settle();
      h.fixture.detectChanges();
    };
    const flushHistory = async () => {
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/inspections`).flush([]);
      await settle();
      h.fixture.detectChanges();
    };
    const openMenu = (id: string) => {
      (h.el.querySelector(`[data-installation="${id}"] .action-btn`) as HTMLButtonElement).click();
      h.fixture.detectChanges();
    };

    beforeEach(async () => {
      await mount(ITEMS);
    });

    it('"Nueva instalación" carga los proveedores activos y abre el formulario en blanco', async () => {
      (h.el.querySelector('[data-action="new"]') as HTMLButtonElement).click();
      await flushSuppliers();
      expect(h.el.querySelector('app-installation-form-modal')).not.toBeNull();
      expect(h.el.querySelector('app-installation-form-modal h4')?.textContent).toContain('Nueva instalación');
      // la que está de baja no se ofrece
      expect(Array.from(h.el.querySelectorAll('#if-supplier option')).map(o => o.textContent?.trim())).toEqual(['Sin proveedor', 'Ascensores Levante']);
    });

    it('al guardar una instalación nueva cierra el formulario y recarga el panel', async () => {
      (h.el.querySelector('[data-action="new"]') as HTMLButtonElement).click();
      await flushSuppliers();
      await settle();
      const name = h.el.querySelector('#if-name') as HTMLInputElement;
      name.value = 'Grupo electrógeno';
      name.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      (h.el.querySelector('app-installation-form-modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      h.fixture.detectChanges();
      await settle();
      h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/estates/e1/assets`).flush({ id: 'a9' });
      await settle();
      h.http.expectOne(url).flush({ upcoming: [], items: [...ITEMS.items, installation({ id: 'a9', name: 'Grupo electrógeno' })] });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-installation-form-modal')).toBeNull();
      expect(h.component.kpis().total).toBe(3);
      expect(h.el.querySelector('[data-installation="a9"]')).not.toBeNull();
    });

    it('cancelar el formulario no recarga nada', async () => {
      (h.el.querySelector('[data-action="new"]') as HTMLButtonElement).click();
      await flushSuppliers();
      (h.el.querySelector('app-installation-form-modal .close-btn') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-installation-form-modal')).toBeNull();
    });

    it('si no cargan los proveedores el formulario se abre igual (con el actual al editar)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      openMenu('a1');
      (h.el.querySelector('.inst-menu [data-action="edit"]') as HTMLButtonElement).click();
      h.http.expectOne(suppliersUrl).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-installation-form-modal')).not.toBeNull();
      expect(Array.from(h.el.querySelectorAll('#if-supplier option')).map(o => o.textContent?.trim())).toEqual(['Sin proveedor', 'Ascensores Levante']);
    });

    it('"Editar" del menú abre el formulario con los datos de esa instalación', async () => {
      openMenu('a1');
      (h.el.querySelector('.inst-menu [data-action="edit"]') as HTMLButtonElement).click();
      await flushSuppliers();
      await settle();
      expect(h.el.querySelector('app-installation-form-modal h4')?.textContent).toContain('Editar instalación');
      expect((h.el.querySelector('#if-name') as HTMLInputElement).value).toBe('Ascensor A');
      expect(h.el.querySelector('.inst-menu')).toBeNull();
    });

    it('"Ver ficha" del menú abre la ficha con su historial y la X la cierra', async () => {
      openMenu('a2');
      (h.el.querySelector('.inst-menu [data-action="detail"]') as HTMLButtonElement).click();
      await flushHistory();
      expect(h.el.querySelector('app-installation-detail-modal h4')?.textContent).toBe('Piscina');
      expect(h.el.querySelector('.inst-menu')).toBeNull();
      (h.el.querySelector('app-installation-detail-modal .close-btn') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-installation-detail-modal')).toBeNull();
    });

    it('pulsar una fila abre su ficha', async () => {
      (h.el.querySelector('[data-installation="a1"]') as HTMLElement).click();
      h.fixture.detectChanges();
      await flushHistory();
      expect(h.el.querySelector('app-installation-detail-modal h4')?.textContent).toBe('Ascensor A');
    });

    it('Enter sobre una fila abre su ficha y el botón de tres puntos no la abre', async () => {
      openMenu('a1');
      expect(h.el.querySelector('app-installation-detail-modal')).toBeNull();
      (h.el.querySelector('.menu-backdrop') as HTMLElement).click();
      h.fixture.detectChanges();
      (h.el.querySelector('[data-installation="a2"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      h.fixture.detectChanges();
      await flushHistory();
      expect(h.el.querySelector('app-installation-detail-modal h4')?.textContent).toBe('Piscina');
    });

    it('"Editar" dentro de la ficha la cierra y abre el formulario', async () => {
      (h.el.querySelector('[data-installation="a1"]') as HTMLElement).click();
      h.fixture.detectChanges();
      await flushHistory();
      (h.el.querySelector('app-installation-detail-modal [data-action="edit"]') as HTMLButtonElement).click();
      await flushSuppliers();
      expect(h.el.querySelector('app-installation-detail-modal')).toBeNull();
      expect(h.el.querySelector('app-installation-form-modal h4')?.textContent).toContain('Editar instalación');
    });
  });

  describe('enlace a las incidencias', () => {
    beforeEach(async () => {
      await mount({
        upcoming: [],
        items: [installation({ id: 'a1', name: 'Cubierta', openIssues: 2 }), installation({ id: 'a2', name: 'Piscina', openIssues: 0 })],
      });
    });

    it('el número de incidencias es un botón que lleva a las de esa instalación, sin abrir su ficha', () => {
      const opened: { id: string; name: string }[] = [];
      h.component.openIssues.subscribe((asset) => opened.push(asset));
      const button = h.el.querySelector('[data-installation="a1"] .inst-issues') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('2 incidencias abiertas de Cubierta');
      button.click();
      h.fixture.detectChanges();
      expect(opened).toEqual([{ id: 'a1', name: 'Cubierta' }]);
      expect(h.el.querySelector('app-installation-detail-modal')).toBeNull();
    });

    it('sin incidencias no hay enlace', () => {
      expect(h.el.querySelector('[data-installation="a2"] .inst-issues')).toBeNull();
    });
  });
});
