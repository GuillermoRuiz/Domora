import { setupComponent } from '../../../../core/testing/component-harness';
import { DEFAULT_FILTERS, type ContractFilters } from '../contracts-model';
import { ContractsToolbarComponent } from './contracts-toolbar.component';

describe('ContractsToolbarComponent', () => {
  function mount(filters: ContractFilters = DEFAULT_FILTERS) {
    const h = setupComponent(ContractsToolbarComponent);
    h.fixture.componentRef.setInput('filters', filters);
    h.fixture.componentRef.setInput('suppliers', [{ id: 's1', name: 'Schindler' }, { id: 's2', name: 'Limpiezas Madrid' }]);
    h.fixture.componentRef.setInput('categories', ['Ascensores', 'Limpieza']);
    h.fixture.detectChanges();
    const emitted: ContractFilters[] = [];
    h.component.filtersChange.subscribe((f) => emitted.push(f));
    return { h, emitted };
  }
  const sel = (h: { el: HTMLElement }, id: string) => h.el.querySelector(`#${id}`) as HTMLSelectElement | HTMLInputElement;
  function choose(h: { el: HTMLElement; fixture: { detectChanges(): void } }, id: string, value: string) {
    const el = sel(h, id);
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('muestra el buscador y los filtros del mockup con las opciones reales', () => {
    const { h } = mount();
    expect((sel(h, 'contracts-search') as HTMLInputElement).placeholder).toContain('Buscar contratos, proveedor o servicio');
    const labels = Array.from(h.el.querySelectorAll('.toolbar__field label, .toolbar__field .toolbar__label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Vigencia', 'Proveedor', 'Renovación', 'Categoría', 'Vencimiento', 'Ordenar por']);
    expect(Array.from(sel(h, 'contracts-vigencia').querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual(['Todos', 'Activos', 'Por vencer', 'Vencidos', 'Programados', 'Cancelados']);
    expect(Array.from(sel(h, 'contracts-supplier').querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual(['Todos', 'Schindler', 'Limpiezas Madrid']);
    expect(Array.from(sel(h, 'contracts-category').querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual(['Todas', 'Ascensores', 'Limpieza']);
    expect(Array.from(sel(h, 'contracts-sort').querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual([
      'Vencimiento (más próximo)', 'Vencimiento (más lejano)', 'Importe anual (mayor)', 'Proveedor (A-Z)', 'Inicio (más reciente)',
    ]);
  });

  it('cada control emite el conjunto de filtros con su cambio y conserva el resto', () => {
    const { h, emitted } = mount({ ...DEFAULT_FILTERS, vigencia: 'activos' });
    choose(h, 'contracts-search', 'asc');
    choose(h, 'contracts-supplier', 's2');
    choose(h, 'contracts-renewal', 'tacita');
    choose(h, 'contracts-category', 'Limpieza');
    choose(h, 'contracts-from', '2026-01-01');
    choose(h, 'contracts-to', '2026-12-31');
    choose(h, 'contracts-sort', 'importe_desc');
    choose(h, 'contracts-vigencia', 'vencidos');
    const last = (key: keyof ContractFilters) => emitted.map((f) => f[key]).filter((v) => v !== DEFAULT_FILTERS[key]).pop();
    expect(last('search')).toBe('asc');
    expect(last('supplierId')).toBe('s2');
    expect(last('renewal')).toBe('tacita');
    expect(last('category')).toBe('Limpieza');
    expect(last('from')).toBe('2026-01-01');
    expect(last('to')).toBe('2026-12-31');
    expect(last('sort')).toBe('importe_desc');
    expect(emitted.at(-1)?.vigencia).toBe('vencidos');
    // El primer emitido conserva la vigencia que ya estaba.
    expect(emitted[0]).toEqual({ ...DEFAULT_FILTERS, vigencia: 'activos', search: 'asc' });
  });

  it('«Quitar filtros» solo aparece con filtros aplicados y conserva el orden elegido', () => {
    const none = mount({ ...DEFAULT_FILTERS, sort: 'proveedor' });
    expect(none.h.el.querySelector('.toolbar__clear')).toBeNull(); // el orden no cuenta como filtro
    none.h.fixture.componentRef.setInput('filters', { ...DEFAULT_FILTERS, sort: 'proveedor', search: 'x', vigencia: 'vencidos' });
    none.h.fixture.detectChanges();
    (none.h.el.querySelector('.toolbar__clear') as HTMLButtonElement).click();
    expect(none.emitted).toEqual([{ ...DEFAULT_FILTERS, sort: 'proveedor' }]);
  });

  it('el rango de fechas no permite un hasta anterior al desde', () => {
    const { h } = mount({ ...DEFAULT_FILTERS, from: '2026-03-01', to: '2026-09-01' });
    expect((sel(h, 'contracts-from') as HTMLInputElement).max).toBe('2026-09-01');
    expect((sel(h, 'contracts-to') as HTMLInputElement).min).toBe('2026-03-01');
  });
});
