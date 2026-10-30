import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { EMPTY_FILTERS, TaskFilterState, TaskFiltersComponent, activeFilterCount } from './task-filters.component';

type Harness = ComponentHarness<TaskFiltersComponent>;

async function open(filters: TaskFilterState = EMPTY_FILTERS): Promise<Harness> {
  const h = setupComponent(TaskFiltersComponent, { user: makeUser({ role: 'B' }) });
  h.fixture.componentRef.setInput('filters', filters);
  h.fixture.detectChanges();
  await settle();
  h.component.catalog.labels.set([
    { id: 'l1', name: 'Ascensor' },
    { id: 'l2', name: 'Seguro' },
  ]);
  h.fixture.detectChanges();
  return h;
}

describe('TaskFiltersComponent', () => {
  it('cada filtro emite el estado completo con SOLO ese campo cambiado (los filtros se combinan)', async () => {
    const h = await open({ ...EMPTY_FILTERS, estateId: 'e1', labelIds: [] });
    const emitted: TaskFilterState[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));

    h.component.set('priority', 'URGENTE');

    expect(emitted).toEqual([{ ...EMPTY_FILTERS, estateId: 'e1', priority: 'URGENTE', labelIds: [] }]);
  });

  it('los desplegables reflejan el filtro activo y ofrecen "sin filtrar" más los datos reales del catálogo', async () => {
    const h = await open({ ...EMPTY_FILTERS, priority: 'ALTA' });
    h.component.catalog.estates.set([{ id: 'e1', name: 'Comunidad Sol' }] as never);
    h.fixture.detectChanges();
    const triggers = Array.from(h.el.querySelectorAll<HTMLElement>('app-dropdown .dd__trigger'));
    const byName = (name: string) => triggers.find((t) => t.getAttribute('aria-label') === name)!;

    expect(byName('Prioridad').textContent).toContain('Alta');
    expect(byName('Prioridad').classList).toContain('dd__trigger--active');
    expect(byName('Estado').textContent).toContain('Todos los estados');
    expect(byName('Estado').classList).not.toContain('dd__trigger--active');
    expect(byName('Comunidad')).toBeUndefined();
    expect(h.component.assigneeItems().slice(0, 3).map((i) => i.id)).toEqual(['', 'me', 'none']);
  });

  it('elegir una opción en un desplegable emite el estado con ese campo (y "" restablece)', async () => {
    const h = await open({ ...EMPTY_FILTERS, status: 'PENDIENTE' });
    const emitted: TaskFilterState[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));
    const estado = Array.from(h.el.querySelectorAll<HTMLElement>('app-dropdown')).find((d) => d.querySelector('.dd__trigger')?.getAttribute('aria-label') === 'Estado')!;

    estado.querySelector<HTMLElement>('.dd__trigger')!.click();
    h.fixture.detectChanges();
    estado.querySelectorAll<HTMLElement>('.dd__option')[0].click(); // "Todos los estados"

    expect(emitted).toEqual([{ ...EMPTY_FILTERS, status: '', labelIds: [] }]);
  });

  it('las etiquetas se activan y desactivan de forma independiente (selección múltiple)', async () => {
    const h = await open();
    const emitted: TaskFilterState[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));

    h.component.toggleLabel('l1');
    h.fixture.componentRef.setInput('filters', { ...EMPTY_FILTERS, labelIds: ['l1'] });
    h.component.toggleLabel('l2');
    h.fixture.componentRef.setInput('filters', { ...EMPTY_FILTERS, labelIds: ['l1', 'l2'] });
    h.component.toggleLabel('l1');

    expect(emitted.map((f) => f.labelIds)).toEqual([['l1'], ['l1', 'l2'], ['l2']]);
  });

  it('las etiquetas son un desplegable múltiple: cada clic marca o desmarca y la lista sigue abierta', async () => {
    const h = await open();
    const emitted: TaskFilterState[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));
    h.fixture.componentRef.setInput('filters', { ...EMPTY_FILTERS });
    const dropdown = Array.from(h.el.querySelectorAll<HTMLElement>('app-dropdown')).find((d) => d.querySelector('.dd__trigger')?.getAttribute('aria-label') === 'Etiquetas')!;
    dropdown.querySelector<HTMLElement>('.dd__trigger')!.click();
    h.fixture.detectChanges();
    const options = () => Array.from(dropdown.querySelectorAll<HTMLElement>('.dd__option'));
    expect(options().map((o) => o.textContent?.trim())).toEqual(['Ascensor', 'Seguro']);

    options()[1].click();
    h.fixture.detectChanges();

    expect(emitted.map((f) => f.labelIds)).toEqual([['l2']]);
    expect(dropdown.querySelector('.dd__trigger')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('el desplegable de etiquetas resume la selección y marca las opciones elegidas', async () => {
    const h = await open({ ...EMPTY_FILTERS, labelIds: ['l1', 'l2'] });
    const dropdown = Array.from(h.el.querySelectorAll<HTMLElement>('app-dropdown')).find((d) => d.querySelector('.dd__trigger')?.getAttribute('aria-label') === 'Etiquetas')!;
    expect(dropdown.querySelector('.dd__value')?.textContent?.trim()).toBe('2 etiquetas');
    expect(dropdown.querySelectorAll('.dd__option[aria-selected=true]').length).toBe(2);
    expect(dropdown.querySelector('.dd__trigger--active')).not.toBeNull();
  });

  it('los controles tienen nombre accesible y el botón de filtros expone su estado', async () => {
    const h = await open();

    const labels = Array.from(h.el.querySelectorAll('app-dropdown .dd__trigger')).map((s) => s.getAttribute('aria-label'));
    expect(labels).toEqual(['Responsable', 'Estado', 'Prioridad', 'Tipo', 'Etiquetas']);
    expect(h.el.querySelector('.filters__toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('cuenta los filtros activos y "Limpiar filtros" los restablece', async () => {
    const filters: TaskFilterState = { ...EMPTY_FILTERS, estateId: 'e1', priority: 'ALTA', labelIds: ['l1', 'l2'] };
    const h = await open(filters);
    const emitted: TaskFilterState[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));

    expect(activeFilterCount(filters)).toBe(2); // la comunidad pertenece al header
    expect(h.el.querySelector('.filters__count')?.textContent?.trim()).toBe('2');
    h.component.clear();

    expect(emitted).toEqual([{ ...EMPTY_FILTERS, estateId: 'e1', labelIds: [] }]);
  });

  it('sin filtros activos no ofrece "Limpiar filtros"', async () => {
    const h = await open();
    expect(h.el.querySelector('.filters__clear')).toBeNull();
    void API;
  });
});
