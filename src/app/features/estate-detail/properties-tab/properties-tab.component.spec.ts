import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { PropertiesTabComponent } from './properties-tab.component';
import type { ExternalOwner, OwnerProperty } from '../../../core/models';

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return {
    id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado',
    viaType: 'Calle', viaName: 'Mayor', streetNumber: '10', staircase: '1', floor: '2', door: 'A',
    ref: '1-2A', quotaMonthly: 100, balance: 0, pendingDocs: 0,
    ...overrides,
  } as OwnerProperty;
}

function makeExternalOwner(overrides: Partial<ExternalOwner> = {}): ExternalOwner {
  return {
    id: 'eo1', propertyId: 'p1', fullName: 'Titular Importado', roleType: 'Propietario',
    createdAt: '2026-09-01', createdByUserId: 'b1', promotedToUserId: null,
    ...overrides,
  };
}

describe('PropertiesTabComponent', () => {
  let h: ComponentHarness<PropertiesTabComponent>;

  function mount(
    properties: OwnerProperty[],
    opts: { externalOwners?: Record<string, ExternalOwner> } = {},
  ): void {
    h = setupComponent(PropertiesTabComponent);
    h.component.estateId = 'e1';
    h.component.propertiesLoaded = true;
    h.component.externalOwnerByProperty = opts.externalOwners ?? {};
    h.fixture.componentRef.setInput('properties', properties);
    h.fixture.detectChanges();
  }

  const STATUSES_URL = `${API}/estates/e1/dashboard/property-statuses`;

  /** Responde la carga de saldos que la pestaña pide al montarse. */
  async function loadStatuses(items: { propertyId: string; balance: number; status: 'ok' | 'overdue'; lastPaymentDate?: string | null; ownerSince?: string | null }[]) {
    h.http.expectOne(STATUSES_URL).flush({ items });
    await settle();
    h.fixture.detectChanges();
  }

  const OFFICE_TERMS_URL = `${API}/estates/e1/office-terms`;

  afterEach(() => {
    h.http.match(OFFICE_TERMS_URL).forEach((req) => req.flush([]));
    h.http.match(STATUSES_URL).forEach((req) => req.flush({ items: [] }));
    h.http.match((r) => r.url === `${API}/estates/e1/dashboard/activity`).forEach((req) => req.flush({ items: [] }));
    h.http.verify();
  });

  describe('fila de KPIs', () => {
    const kpi = (id: string) => h.el.querySelector(`[data-kpi="${id}"]`) as HTMLElement;
    const text = (id: string) => kpi(id).textContent?.replace(/\s+/g, ' ').trim();
    const rows = () => Array.from(h.el.querySelectorAll('.table tbody tr')).map((tr) => tr.querySelector('.td--mono')?.textContent?.trim());

    beforeEach(async () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', type: 'Piso' }),
        makeProperty({ id: 'p2', ref: '2B', type: 'Casa' }),
        makeProperty({ id: 'p3', ref: 'L1', type: 'Local' }),
        makeProperty({ id: 'p4', ref: 'P01', type: 'Parking' }),
      ]);
      await loadStatuses([
        { propertyId: 'p1', balance: 0, status: 'ok', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p2', balance: 1000.5, status: 'overdue', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p3', balance: 400, status: 'overdue', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p4', balance: 0, status: 'ok', lastPaymentDate: null, ownerSince: null },
      ]);
    });

    it('total, viviendas (piso y casa) y locales, con su porcentaje sobre el total', () => {
      expect(text('total')).toContain('4');
      expect(text('housing')).toMatch(/Viviendas\s?2\s?unidades · 50 %/);
      expect(text('commercial')).toMatch(/Locales\s?1\s?unidades · 25 %/);
      expect(kpi('housing').querySelector<HTMLElement>('.kpi__bar-fill')?.style.width).toBe('50%');
    });

    it('morosidad suma los saldos pendientes y cuenta las propiedades (con saldo pendiente)', () => {
      expect(text('delinquency')).toMatch(/Morosidad\s?1\.400,50\s?€\s?2 propiedades \(50 %\)/);
      expect(kpi('delinquency').querySelector('.kpi--danger')).not.toBeNull();
    });

    it('clic en Morosidad deja solo las que deben y otro clic lo quita; clic en Total quita todos los filtros', () => {
      (kpi('delinquency') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(rows()).toEqual(['2B', 'L1']);
      expect(kpi('delinquency').getAttribute('aria-pressed')).toBe('true');

      (kpi('delinquency') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(rows()).toEqual(['1A', '2B', 'L1', 'P01']);

      (kpi('delinquency') as HTMLButtonElement).click();
      (kpi('total') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(rows()).toHaveLength(4);
      expect(h.component.hasFilters()).toBe(false);
    });
  });

  describe('propiedad destacada', () => {
    const featured = () => h.el.querySelector('app-featured-property-card .featured__ref')?.textContent?.trim();

    beforeEach(async () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A' }),
        makeProperty({ id: 'p2', ref: '2B' }),
        makeProperty({ id: 'p3', ref: '3C' }),
      ]);
    });

    it('por defecto es la de mayor deuda', async () => {
      await loadStatuses([
        { propertyId: 'p1', balance: 50, status: 'overdue', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p2', balance: 1200, status: 'overdue', lastPaymentDate: '2024-12-12', ownerSince: '2019-03-14' },
        { propertyId: 'p3', balance: 0, status: 'ok', lastPaymentDate: null, ownerSince: null },
      ]);
      expect(featured()).toBe('2B');
      expect(h.el.querySelector('app-featured-property-card [data-detail="lastPayment"] dd')?.textContent).toContain('12 dic 2024');
    });

    it('mientras no hay saldos (o si fallan) muestra la primera por referencia, sin inventar deuda', () => {
      expect(featured()).toBe('1A');
      expect(h.el.querySelector('app-featured-property-card [data-detail="balance"] dd')?.textContent?.trim()).toBe('—');
    });

    it('pulsar una fila la selecciona (y la marca) en vez de abrir su edición', async () => {
      await loadStatuses([
        { propertyId: 'p1', balance: 50, status: 'overdue', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p2', balance: 1200, status: 'overdue', lastPaymentDate: null, ownerSince: null },
        { propertyId: 'p3', balance: 0, status: 'ok', lastPaymentDate: null, ownerSince: null },
      ]);
      (h.el.querySelector('[data-property="p3"]') as HTMLElement).click();
      h.fixture.detectChanges();
      expect(featured()).toBe('3C');
      expect(h.el.querySelector('[data-property="p3"]')?.getAttribute('aria-selected')).toBe('true');
      expect(h.el.querySelector('[data-property="p3"]')?.classList).toContain('row--selected');
      expect(h.component.showEditProperty()).toBe(false);
    });

    it('Enter sobre la fila también la selecciona', () => {
      (h.el.querySelector('[data-property="p2"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      h.fixture.detectChanges();
      expect(featured()).toBe('2B');
    });

    it('"Ver propiedad" de la ficha abre la edición de esa propiedad', () => {
      (h.el.querySelector('[data-property="p2"]') as HTMLElement).click();
      h.fixture.detectChanges();
      (h.el.querySelector('app-featured-property-card .section-card__action') as HTMLButtonElement).click();
      expect(h.component.editPropertyId()).toBe('p2');
    });

    it('si la seleccionada desaparece vuelve a la de mayor deuda', async () => {
      (h.el.querySelector('[data-property="p3"]') as HTMLElement).click();
      h.fixture.componentRef.setInput('properties', [makeProperty({ id: 'p1', ref: '1A' }), makeProperty({ id: 'p2', ref: '2B' })]);
      h.fixture.detectChanges();
      expect(featured()).toBe('1A');
    });

    it('la foto es la fachada de la finca', () => {
      h.fixture.componentRef.setInput('facadeUrl', 'https://catastro.test/f.jpg');
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-featured-property-card img')?.getAttribute('src')).toBe('https://catastro.test/f.jpg');
    });
  });

  describe('tabla', () => {
    beforeEach(async () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', type: 'Piso', quotaMonthly: 120, floor: '1', door: 'A' }),
        makeProperty({ id: 'p2', ref: 'L1', type: 'Local', quotaMonthly: 180.5 }),
      ]);
      await loadStatuses([
        { propertyId: 'p1', balance: 0, status: 'ok', lastPaymentDate: '2026-09-02', ownerSince: null },
        { propertyId: 'p2', balance: 80, status: 'overdue', lastPaymentDate: null, ownerSince: null },
      ]);
    });
    const cell = (id: string, i: number) => h.el.querySelector(`[data-property="${id}"]`)!.querySelectorAll('td')[i].textContent?.replace(/\s+/g, ' ').trim();

    it('columnas: Ref., Tipo con icono, Planta/Ubicación, Titular, Estado, Cuota, Saldo, Último pago y Acción — sin casillas', () => {
      expect(Array.from(h.el.querySelectorAll('.table thead th')).map((th) => th.textContent?.replace(/\s+/g, ' ').trim()))
        .toEqual(['Ref.', 'Tipo', 'Planta / Ubicación', 'Titular / Propietario', 'Estado', 'Cuota mensual', 'Saldo pendiente', 'Último pago', 'Acción']);
      expect(h.el.querySelector('.table input[type="checkbox"]')).toBeNull();
    });

    it('el tipo se muestra como Vivienda/Local con su icono', () => {
      expect(cell('p1', 1)).toBe('Vivienda');
      expect(cell('p2', 1)).toBe('Local');
      expect(h.el.querySelectorAll('[data-property] .prop-type app-icon')).toHaveLength(2);
    });

    it('cuota mensual y último pago (fecha corta, o guion si nunca ha pagado)', () => {
      expect(cell('p1', 5)).toMatch(/^120,00\s?€$/);
      expect(cell('p2', 5)).toMatch(/^180,50\s?€$/);
      expect(cell('p1', 7)).toMatch(/^02 sept?\.? 2026$/);
      expect(cell('p2', 7)).toBe('—');
    });

    it('"Ver" abre la edición de esa propiedad sin disparar dos veces el clic de la fila', () => {
      (h.el.querySelector('[data-property="p2"] .view-btn') as HTMLButtonElement).click();
      expect(h.component.editPropertyId()).toBe('p2');
    });

    it('la cabecera "Ref." alterna A-Z / Z-A y lo indica con aria-sort', () => {
      const th = () => h.el.querySelector('.table thead th')!;
      expect(th().getAttribute('aria-sort')).toBe('ascending');
      (h.el.querySelector('[data-sort="ref"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(th().getAttribute('aria-sort')).toBe('descending');
      expect(Array.from(h.el.querySelectorAll('[data-property]')).map((r) => r.getAttribute('data-property'))).toEqual(['p2', 'p1']);
    });
  });

  describe('paginación', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => makeProperty({ id: `p${i + 1}`, ref: `R${String(i + 1).padStart(2, '0')}` }));
    const rows = () => Array.from(h.el.querySelectorAll('[data-property]')).map((r) => r.querySelector('.td--mono')?.textContent?.trim());
    const range = () => h.el.querySelector('.pager__range')?.textContent?.trim();
    const click = (page: string) => { (h.el.querySelector(`.pager [data-page="${page}"]`) as HTMLButtonElement).click(); h.fixture.detectChanges(); };
    const buttons = () => Array.from(h.el.querySelectorAll('.pager__pages > *')).map((e) => e.textContent?.trim());

    it('muestra 10 filas por defecto, con el rango y las páginas', () => {
      mount(many(25));
      expect(rows()).toHaveLength(10);
      expect(rows()[0]).toBe('R01');
      expect(range()).toBe('Mostrando 1-10 de 25 propiedades');
      expect(buttons()).toEqual(['‹', '1', '2', '3', '›']);
      expect(h.el.querySelector('.pager [data-page="1"]')?.getAttribute('aria-current')).toBe('page');
      expect((h.el.querySelector('.pager [data-page="prev"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('navega con los números y con anterior/siguiente; la última página es parcial', () => {
      mount(many(25));
      click('2');
      expect(rows()[0]).toBe('R11');
      expect(range()).toBe('Mostrando 11-20 de 25 propiedades');
      click('next');
      expect(rows()).toEqual(['R21', 'R22', 'R23', 'R24', 'R25']);
      expect(range()).toBe('Mostrando 21-25 de 25 propiedades');
      expect((h.el.querySelector('.pager [data-page="next"]') as HTMLButtonElement).disabled).toBe(true);
      click('prev');
      expect(rows()[0]).toBe('R11');
    });

    it('filas por página: 25 muestra todo y vuelve a la primera página', () => {
      mount(many(25));
      click('3');
      const select = h.el.querySelector('#prop-page-size') as HTMLSelectElement;
      select.value = select.options[1].value; // 25
      select.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      expect(h.component.pageSize()).toBe(25);
      expect(rows()).toHaveLength(25);
      expect(range()).toBe('Mostrando 1-25 de 25 propiedades');
      expect(buttons()).toEqual(['‹', '1', '›']);
    });

    it('cambiar un filtro vuelve a la primera página y el rango cuenta solo lo filtrado', () => {
      mount(many(25));
      click('3');
      const search = h.el.querySelector('#prop-search') as HTMLInputElement;
      search.value = 'R1';
      search.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      expect(range()).toBe('Mostrando 1-10 de 10 propiedades'); // R10…R19, y estábamos en la página 3
    });

    it('con muchas páginas usa elipsis alrededor de la actual', () => {
      mount(many(120)); // 12 páginas
      expect(buttons()).toEqual(['‹', '1', '2', '…', '12', '›']);
      click('2');
      click('3');
      click('4');
      click('5');
      click('6');
      expect(buttons()).toEqual(['‹', '1', '…', '5', '6', '7', '…', '12', '›']);
    });

    it('una elipsis nunca esconde una sola página', () => {
      mount(many(40)); // 4 páginas: 1 2 3 4, sin "…"
      expect(buttons()).toEqual(['‹', '1', '2', '3', '4', '›']);
    });

    it('sin resultados no hay paginador', () => {
      mount(many(25));
      const search = h.el.querySelector('#prop-search') as HTMLInputElement;
      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      expect(h.el.querySelector('.pager')).toBeNull();
    });
  });

  describe('saldo, estado de pago y filtros', () => {
    const rows = () => Array.from(h.el.querySelectorAll('.table tbody tr')).map((tr) => tr.querySelector('.td--mono')?.textContent?.trim());
    const set = (id: string, value: string, event = 'input') => {
      const el = h.el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
      el.value = value;
      el.dispatchEvent(new Event(event));
      h.fixture.detectChanges();
    };

    beforeEach(async () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', type: 'Piso' }),
        makeProperty({ id: 'p2', ref: '2B', type: 'Piso' }),
        makeProperty({ id: 'p3', ref: 'L1', type: 'Local' }),
      ]);
      await loadStatuses([
        { propertyId: 'p1', balance: 0, status: 'ok' },
        { propertyId: 'p2', balance: 1240.5, status: 'overdue' },
        { propertyId: 'p3', balance: 80, status: 'overdue' },
      ]);
    });

    it('cada fila muestra su estado de pago y su saldo (en rojo si debe)', () => {
      const cells = (i: number) => h.el.querySelectorAll('.table tbody tr')[i].querySelectorAll('td');
      expect(cells(1)[4].textContent).toContain('En mora');
      expect(cells(1)[6].textContent?.replace(/\s/g, ' ')).toMatch(/1\.240,50\s?€/);
      expect(cells(1)[6].classList).toContain('td--owes');
      expect(cells(0)[4].textContent).toContain('Al día');
      expect(cells(0)[6].classList).not.toContain('td--owes');
    });

    it('filtrar por estado de pago deja solo esas propiedades y cuenta la deuda visible', () => {
      set('prop-payment', 'overdue', 'change');
      expect(rows()).toEqual(['2B', 'L1']);
      expect(h.el.querySelector('.pager__range')?.textContent?.trim()).toBe('Mostrando 1-2 de 2 propiedades');
    });

    it('filtrar por tipo y buscar por referencia se combinan', () => {
      set('prop-type', 'Vivienda', 'change');
      expect(rows()).toEqual(['1A', '2B']);
      set('prop-search', '2b');
      expect(rows()).toEqual(['2B']);
    });

    it('"Vivienda" agrupa piso y casa', () => {
      h.fixture.componentRef.setInput('properties', [
        makeProperty({ id: 'p1', ref: '1A', type: 'Piso' }),
        makeProperty({ id: 'p2', ref: 'C1', type: 'Casa' }),
        makeProperty({ id: 'p3', ref: 'L1', type: 'Local' }),
      ]);
      h.fixture.detectChanges();
      set('prop-type', 'Vivienda', 'change');
      expect(rows()).toEqual(['1A', 'C1']);
    });

    it('el filtro Deuda separa a quien debe de quien no', () => {
      set('prop-debt', 'owes', 'change');
      expect(rows()).toEqual(['2B', 'L1']);
      set('prop-debt', 'clear', 'change');
      expect(rows()).toEqual(['1A']);
    });

    it('el filtro Propietario ofrece los titulares y deja solo sus propiedades, aunque los titulares lleguen después', () => {
      expect(Array.from(h.el.querySelectorAll('#prop-owner option')).map((o) => o.textContent?.trim())).toEqual(['Todos']);
      h.component.titularByProperty = {
        p1: { name: 'Zoe Alba', roleType: 'Propietario' },
        p2: { name: 'Ana Rey', roleType: 'Propietario' },
        p3: { name: 'Ana Rey', roleType: 'Propietario' },
      };
      h.fixture.detectChanges();
      expect(Array.from(h.el.querySelectorAll('#prop-owner option')).map((o) => o.textContent?.trim())).toEqual(['Todos', 'Ana Rey', 'Zoe Alba']);
      set('prop-owner', 'Ana Rey', 'change');
      expect(rows()).toEqual(['2B', 'L1']);
    });

    it('ordena por referencia (natural), por saldo y por último pago', () => {
      h.fixture.componentRef.setInput('properties', [
        makeProperty({ id: 'p1', ref: '10A' }),
        makeProperty({ id: 'p2', ref: '2B' }),
        makeProperty({ id: 'p3', ref: 'L1' }),
      ]);
      h.fixture.detectChanges();
      expect(rows()).toEqual(['2B', '10A', 'L1']); // A-Z con números naturales: 2 antes que 10
      set('prop-sort', 'ref-desc', 'change');
      expect(rows()).toEqual(['L1', '10A', '2B']);
      set('prop-sort', 'balance-desc', 'change');
      expect(rows()).toEqual(['2B', 'L1', '10A']); // 1.240,50 · 80 · 0
    });

    it('sin coincidencias lo dice y "Limpiar filtros" lo restaura todo', () => {
      set('prop-search', 'zzz');
      expect(rows()).toEqual([]);
      expect(h.el.textContent).toContain('Ninguna propiedad coincide');
      (h.el.querySelector('.filters__clear') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(rows()).toEqual(['1A', '2B', 'L1']);
      expect(h.el.querySelector('.filters__clear')).toBeNull();
    });
  });

  it('ordenar por último pago pone primero al que pagó más recientemente y al final a quien nunca ha pagado', async () => {
    mount([makeProperty({ id: 'p1', ref: '1A' }), makeProperty({ id: 'p2', ref: '2B' }), makeProperty({ id: 'p3', ref: '3C' })]);
    await loadStatuses([
      { propertyId: 'p1', balance: 0, status: 'ok', lastPaymentDate: '2026-01-10', ownerSince: null },
      { propertyId: 'p2', balance: 0, status: 'ok', lastPaymentDate: null, ownerSince: null },
      { propertyId: 'p3', balance: 0, status: 'ok', lastPaymentDate: '2026-09-02', ownerSince: null },
    ]);
    const select = h.el.querySelector('#prop-sort') as HTMLSelectElement;
    select.value = 'payment-desc';
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(Array.from(h.el.querySelectorAll('.table tbody tr')).map((tr) => tr.querySelector('.td--mono')?.textContent?.trim())).toEqual(['3C', '1A', '2B']);
  });

  it('si fallan los saldos la tabla sigue funcionando, con guion en vez de saldo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount([makeProperty({ id: 'p1', ref: '1A' })]);
    h.http.expectOne(STATUSES_URL).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.table tbody tr')).toHaveLength(1);
    expect(h.el.querySelectorAll('.table tbody tr td')[6].textContent?.trim()).toBe('—'); // saldo
    expect(h.el.querySelectorAll('.table tbody tr td')[5].textContent).toMatch(/100,00\s?€/); // la cuota sigue
  });

  describe('tabla y edición', () => {
    beforeEach(() => mount([makeProperty({ id: 'p1', type: 'Piso', ref: '3A', floor: '3', door: 'A' })]));

    it('renderiza la tabla de propiedades', () => {
      expect(h.el.querySelectorAll('.table tbody tr')).toHaveLength(1);
      expect(h.el.querySelector('.td--mono')?.textContent).toContain('3A');
    });

    it('abrir el modal de edición lo precarga con los datos de la propiedad', () => {
      h.component.openEditProperty(h.component.properties()[0]);
      h.fixture.detectChanges();

      expect(h.component.showEditProperty()).toBe(true);
      expect(h.component.epViaName()).toBe('Mayor');
      expect(h.component.epFloor()).toBe('3');
      expect(h.component.epDoor()).toBe('A');
      expect(h.el.querySelector('.modal-backdrop')).not.toBeNull();
    });

    it('guardar la edición hace PATCH, refleja el cambio y avisa a la puesta en marcha', async () => {
      const setupChanged = vi.fn();
      h.component.setupChanged.subscribe(setupChanged);
      h.component.openEditProperty(h.component.properties()[0]);
      h.component.epViaName.set('Calle Nueva');
      h.component.epFloor.set('5');

      const promise = h.component.saveEditProperty();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ viaName: 'Calle Nueva', floor: '5' });
      req.flush({ ...h.component.properties()[0], viaName: 'Calle Nueva', floor: '5' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showEditProperty()).toBe(false);
      expect(h.component.properties()[0].viaName).toBe('Calle Nueva');
      expect(setupChanged).toHaveBeenCalledTimes(1);
      expect(h.el.querySelector('.toast')?.textContent).toContain('Propiedad actualizada');
    });

    it('cerrar el modal de edición no llama a la API', () => {
      h.component.openEditProperty(h.component.properties()[0]);
      h.component.closeEditProperty();
      h.fixture.detectChanges();

      expect(h.component.showEditProperty()).toBe(false);
      h.http.expectNone((r) => r.method === 'PATCH');
    });

    it('eliminar una propiedad pide confirmación y, si se acepta, hace DELETE y la quita de la tabla', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const promise = h.component.deleteProperty(h.component.properties()[0]);
      expect(confirmSpy).toHaveBeenCalled();
      h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'DELETE').flush(null);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.properties()).toHaveLength(0);
      expect(h.el.querySelectorAll('.table tbody tr')).toHaveLength(0);
    });

    it('si se cancela la confirmación, no elimina nada', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      await h.component.deleteProperty(h.component.properties()[0]);

      expect(h.component.properties()).toHaveLength(1);
      h.http.expectNone((r) => r.method === 'DELETE');
    });
  });

  describe('abrir una propiedad al llegar (enlace desde el Resumen)', () => {
    it('abre la edición de la propiedad indicada y avisa de que ya lo atendió', () => {
      h = setupComponent(PropertiesTabComponent);
      h.component.estateId = 'e1';
      const handled = vi.fn();
      h.component.focusHandled.subscribe(handled);
      h.fixture.componentRef.setInput('properties', [makeProperty({ id: 'p1' }), makeProperty({ id: 'p2', ref: '9Z' })]);
      h.fixture.componentRef.setInput('focusPropertyId', 'p2');
      h.fixture.detectChanges();

      expect(h.component.showEditProperty()).toBe(true);
      expect(h.component.editPropertyId()).toBe('p2');
      expect(handled).toHaveBeenCalledTimes(1);
    });

    it('si la propiedad aún no está en la lista espera a que llegue', () => {
      h = setupComponent(PropertiesTabComponent);
      h.component.estateId = 'e1';
      h.fixture.componentRef.setInput('properties', []);
      h.fixture.componentRef.setInput('focusPropertyId', 'p2');
      h.fixture.detectChanges();
      expect(h.component.showEditProperty()).toBe(false);

      h.fixture.componentRef.setInput('properties', [makeProperty({ id: 'p2' })]);
      h.fixture.detectChanges();
      expect(h.component.editPropertyId()).toBe('p2');
    });

    it('sin propiedad indicada no abre nada', () => {
      mount([makeProperty({ id: 'p1' })]);
      expect(h.component.showEditProperty()).toBe(false);
    });
  });

  describe('estado vacío', () => {
    it('sin propiedades ofrece importarlas del Catastro', () => {
      mount([]);
      const importar = vi.fn();
      h.component.importCatastro.subscribe(importar);

      const btn = h.el.querySelector('.no-requests app-btn button') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();

      expect(importar).toHaveBeenCalledTimes(1);
    });
  });

  describe('coeficiente de participación', () => {
    it('la tabla ya no tiene columna de coeficiente: se ve y edita en "Ver" y se resume debajo', () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', floor: '1', participationQuota: 2.5 }),
        makeProperty({ id: 'p2', ref: '2A', floor: '2', participationQuota: null }),
      ]);

      expect(Array.from(h.el.querySelectorAll('.table thead th')).map((th) => th.textContent?.trim())).not.toContain('Coef.');
      h.component.openEditProperty(h.component.properties()[0]);
      expect(h.component.epParticipationQuota()).toBe(2.5);
      expect(h.el.textContent).toContain('Suma de coeficientes informados: 2,50 %');
    });

    it('resume la suma de coeficientes informados y cuántas propiedades faltan', () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', floor: '1', participationQuota: 40.25 }),
        makeProperty({ id: 'p2', ref: '2A', floor: '2', participationQuota: 10 }),
        makeProperty({ id: 'p3', ref: '3A', floor: '3', participationQuota: null }),
      ]);

      expect(h.component.quotaSummary()).toEqual({ total: 50.25, missing: 1 });
      expect(h.el.textContent).toContain('Suma de coeficientes informados: 50,25 %');
      expect(h.el.textContent).toContain('1 propiedad sin coeficiente');
    });

    it('avisa si la suma supera el 100 %', () => {
      mount([
        makeProperty({ id: 'p1', ref: '1A', floor: '1', participationQuota: 70 }),
        makeProperty({ id: 'p2', ref: '2A', floor: '2', participationQuota: 40 }),
      ]);

      expect(h.el.textContent).toContain('supera el 100 %');
    });

    it('el modal de edición precarga el coeficiente y lo envía al guardar', async () => {
      mount([makeProperty({ id: 'p1', participationQuota: 2.5 })]);

      h.component.openEditProperty(h.component.properties()[0]);
      expect(h.component.epParticipationQuota()).toBe(2.5);
      h.component.epParticipationQuota.set(3.75);

      const promise = h.component.saveEditProperty();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'PATCH');
      expect(req.request.body.participationQuota).toBe(3.75);
      req.flush({ ...h.component.properties()[0], participationQuota: 3.75 });
      await promise;

      expect(h.component.properties()[0].participationQuota).toBe(3.75);
    });

    it('el modal precarga la cuota mensual y la envía al guardar (antes solo se fijaba en el alta)', async () => {
      mount([makeProperty({ id: 'p1', quotaMonthly: 0 })]);

      h.component.openEditProperty(h.component.properties()[0]);
      expect(h.component.epQuotaMonthly()).toBe(0);
      h.component.epQuotaMonthly.set(92.5);

      const promise = h.component.saveEditProperty();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'PATCH');
      expect(req.request.body.quotaMonthly).toBe(92.5);
      req.flush({ ...h.component.properties()[0], quotaMonthly: 92.5 });
      await promise;
    });

    it('vaciar la cuota no la manda (no admite null): el backend la deja como estaba', async () => {
      mount([makeProperty({ id: 'p1', quotaMonthly: 50 })]);

      h.component.openEditProperty(h.component.properties()[0]);
      h.component.epQuotaMonthly.set(null);

      const promise = h.component.saveEditProperty();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'PATCH');
      expect(req.request.body.quotaMonthly).toBeUndefined();
      req.flush(h.component.properties()[0]);
      await promise;
    });

    it('vaciar el campo manda null (borra el coeficiente), no undefined (que el backend ignoraría)', async () => {
      mount([makeProperty({ id: 'p1', participationQuota: 2.5 })]);

      h.component.openEditProperty(h.component.properties()[0]);
      h.component.epParticipationQuota.set(null);

      const promise = h.component.saveEditProperty();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1` && r.method === 'PATCH');
      expect(req.request.body).toHaveProperty('participationQuota', null);
      req.flush({ ...h.component.properties()[0], participationQuota: null });
      await promise;

      expect(h.component.properties()[0].participationQuota).toBeNull();
    });
  });

  describe('titulares: "Añadir titular" e invitaciones', () => {
    const properties = () => [
      makeProperty({ id: 'p1', ref: '1A' }),
      makeProperty({ id: 'p2', ref: '2A' }),
      makeProperty({ id: 'p3', ref: '3A' }),
    ];

    it('añadir titular crea el propietario sin cuenta y avisa al padre para que recargue titulares y puesta en marcha', async () => {
      mount(properties());
      const added = vi.fn();
      h.component.titularAdded.subscribe(added);

      h.component.openAddTitular(h.component.properties()[0]);
      h.component.atFullName.set('  Ana Titular ');
      h.component.atEmail.set('ana@example.com');
      h.fixture.detectChanges();

      const promise = h.component.saveAddTitular();
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1/external-owners` && r.method === 'POST');
      expect(req.request.body).toEqual({ fullName: 'Ana Titular', email: 'ana@example.com', taxId: undefined, phone: undefined });
      req.flush(makeExternalOwner({ fullName: 'Ana Titular' }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.addTitularPropertyId()).toBeNull();
      expect(added).toHaveBeenCalledTimes(1);
      expect(h.el.querySelector('.toast')?.textContent).toContain('Titular añadido');
    });

    it('"Invitar al titular a la app" solo aparece para titulares importados con email y manda solo su id', async () => {
      mount(properties(), {
        externalOwners: {
          p1: makeExternalOwner({ id: 'eo1', propertyId: 'p1', fullName: 'Con Email', email: 'con.email@example.com' }),
          p2: makeExternalOwner({ id: 'eo2', propertyId: 'p2', fullName: 'Sin Email' }),
        },
      });

      const [p1, p2] = h.component.properties();
      expect(h.component.invitableOwnerOf(p1)?.id).toBe('eo1');
      expect(h.component.invitableOwnerOf(p2)).toBeNull();

      const promise = h.component.inviteExternalOwner(p1);
      const req = h.http.expectOne((r) => r.url === `${API}/properties/p1/memberships/owner-invites`);
      expect(req.request.body).toEqual({ externalOwnerId: 'eo1' });
      req.flush({ inviteUrl: 'u', qrDataUrl: 'q' });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('Invitación enviada a con.email@example.com');
    });

    it('si ya tiene una invitación pendiente, muestra el motivo que da el servidor', async () => {
      mount(properties(), {
        externalOwners: { p1: makeExternalOwner({ id: 'eo1', propertyId: 'p1', email: 'x@example.com' }) },
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const promise = h.component.inviteExternalOwner(h.component.properties()[0]);
      h.http.expectOne((r) => r.url === `${API}/properties/p1/memberships/owner-invites`).flush(
        { message: 'Este titular ya tiene una invitación pendiente: reenvíala desde la lista de invitaciones.' },
        { status: 409, statusText: 'Conflict' },
      );
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('ya tiene una invitación pendiente');
    });

    it('sin nombre o con email inválido, no deja guardar', async () => {
      mount(properties());

      h.component.openAddTitular(h.component.properties()[0]);
      h.fixture.detectChanges();
      const saveBtn = () => Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Añadir titular')) as HTMLButtonElement;
      expect(saveBtn().disabled).toBe(true);

      h.component.atFullName.set('Ana');
      h.component.atEmail.set('no-es-email');
      h.fixture.detectChanges();
      expect(saveBtn().disabled).toBe(true);
      expect(h.el.textContent).toContain('Email no válido');

      await h.component.saveAddTitular();
      h.http.expectNone((r) => r.method === 'POST');
    });
  });

  describe('cargos de la comunidad', () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const yesterday = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
    const lastYear = ymd(new Date(today.getFullYear() - 1, 0, 15));
    const term = (over: Record<string, unknown>) => ({
      estateId: 'e1', role: 'PRESIDENT', propertyId: 'p1', userId: null, externalOwnerId: null,
      holderNameSnapshot: 'Pilar Ruiz', startsAt: lastYear, endsAt: null, propertyReference: '1A', ...over,
    });
    const row = (id: string) => h.el.querySelector(`tr[data-property="${id}"]`) as HTMLElement;
    const menuItems = () => Array.from(h.el.querySelectorAll('.property-row-menu button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    const openMenu = (id: string) => {
      (row(id).querySelector('[aria-label="Más acciones"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
    };

    beforeEach(async () => {
      mount([makeProperty({ id: 'p1', ref: '1A' }), makeProperty({ id: 'p2', ref: '2B' }), makeProperty({ id: 'p3', ref: '3C' })]);
      h.http.expectOne(OFFICE_TERMS_URL).flush([
        term({ id: 'pres' }),
        term({ id: 'v1', role: 'VICE_PRESIDENT', propertyId: 'p2', holderNameSnapshot: 'Ana Gil', startsAt: lastYear }),
        term({ id: 'v2', role: 'VICE_PRESIDENT', propertyId: 'p2', holderNameSnapshot: 'Luis Mora', startsAt: yesterday }),
        term({ id: 'old', propertyId: 'p3', holderNameSnapshot: 'Antiguo', startsAt: '2020-01-01', endsAt: lastYear }),
      ]);
      await loadStatuses([]);
    });

    it('la columna titular muestra el cargo vigente de cada propiedad (y no los ya terminados)', () => {
      expect(Array.from(row('p1').querySelectorAll('.office-chip')).map((c) => c.textContent?.trim())).toEqual(['Presidente']);
      expect(Array.from(row('p2').querySelectorAll('.office-chip')).map((c) => c.textContent?.trim())).toEqual(['Vicepresidente 1º', 'Vicepresidente 2º']);
      expect(row('p3').querySelector('.office-chip')).toBeNull();
      expect(row('p1').querySelector('.office-chip')?.getAttribute('title')).toBe('Presidente: Pilar Ruiz');
    });

    it('el menú de la fila del presidente ofrece cesarle; el de otra fila, nombrar presidente', () => {
      openMenu('p1');
      expect(menuItems()).toContain('Cesar como presidente');
      expect(menuItems()).not.toContain('Nombrar presidente');
      expect(menuItems()).toContain('Nombrar vicepresidente');
      h.component.closePropertyMenu();
      openMenu('p3');
      expect(menuItems()).toContain('Nombrar presidente');
      expect(menuItems()).not.toContain('Cesar como presidente');
    });

    it('«Contactos clave» del menú abre el diálogo de esa propiedad', async () => {
      openMenu('p3');
      (Array.from(h.el.querySelectorAll<HTMLButtonElement>('.property-row-menu button')).find((b) => b.textContent?.includes('Contactos clave')))!.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.property-row-menu')).toBeNull();
      expect(h.el.querySelector('app-key-contacts-dialog')?.textContent).toContain('Propiedad 3C');
      h.http.expectOne(`${OFFICE_TERMS_URL}/candidates`).flush([{ id: 'p3', ref: '3C', holders: [] }]);
      await settle();
    });

    it('con dos vicepresidentes en la misma propiedad, cada opción de cese nombra a la persona', () => {
      openMenu('p2');
      expect(menuItems()).toEqual(expect.arrayContaining(['Cesar como vicepresidente (Ana Gil)', 'Cesar como vicepresidente (Luis Mora)']));
    });

    it('nombrar presidente abre el diálogo y, al guardar, recarga los cargos y lo confirma', async () => {
      openMenu('p3');
      (Array.from(h.el.querySelectorAll<HTMLButtonElement>('.property-row-menu button')).find((b) => b.textContent?.includes('Nombrar presidente')))!.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.property-row-menu')).toBeNull();
      expect(h.el.querySelector('app-office-term-dialog')?.textContent).toContain('Nombrar presidente');
      h.http.expectOne(`${OFFICE_TERMS_URL}/candidates`).flush([{ id: 'p3', ref: '3C', holders: [{ userId: null, externalOwnerId: 'x-eva', name: 'Eva Sanz' }] }]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-office-term-dialog')?.textContent).toContain('Al nombrar a Eva Sanz');

      Array.from(h.el.querySelectorAll<HTMLButtonElement>('app-office-term-dialog .modal__footer button')).at(-1)!.click();
      h.http.expectOne((r) => r.method === 'POST' && r.url === OFFICE_TERMS_URL).flush(term({ id: 'new', propertyId: 'p3', holderNameSnapshot: 'Eva Sanz' }));
      await settle();
      h.http.expectOne((r) => r.method === 'GET' && r.url === OFFICE_TERMS_URL).flush([term({ id: 'new', propertyId: 'p3', holderNameSnapshot: 'Eva Sanz', startsAt: yesterday })]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-office-term-dialog')).toBeNull();
      expect(row('p3').querySelector('.office-chip')?.textContent?.trim()).toBe('Presidente');
      expect(row('p1').querySelector('.office-chip')).toBeNull();
      expect(h.el.textContent).toContain('Nombramiento registrado');
    });
  });
});
