import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateExpenseBreakdown } from '../../../core/estate-dashboard.models';
import { ExpenseBreakdownCardComponent } from './expense-breakdown-card.component';

const BREAKDOWN: EstateExpenseBreakdown = {
  year: 2026,
  total: 5200,
  categories: [
    { key: 'staff', label: 'Personal', amount: 3000 },
    { key: 'maintenance', label: 'Mantenimiento', amount: 1500 },
    { key: 'other', label: 'Otros', amount: 700 },
  ],
};

describe('ExpenseBreakdownCardComponent', () => {
  let h: ComponentHarness<ExpenseBreakdownCardComponent>;
  const url = `${API}/estates/e1/dashboard/expense-breakdown`;

  function mount(year: number | null) {
    h = setupComponent(ExpenseBreakdownCardComponent);
    h.component.estateId = 'e1';
    h.fixture.componentRef.setInput('year', year);
    h.fixture.detectChanges();
  }

  afterEach(() => h.http.verify());

  it('no pide nada hasta que la tarjeta de ingresos y gastos fija el ejercicio', () => {
    mount(null);
    h.http.expectNone((r) => r.url === url);
    expect(h.el.textContent).toContain('Cargando');
  });

  it('pide el ejercicio indicado', async () => {
    mount(2026);
    const req = h.http.expectOne((r) => r.url === url);
    expect(req.request.params.get('year')).toBe('2026');
    req.flush(BREAKDOWN);
    await settle();
  });

  it('muestra categorías con su importe y porcentaje, y el total en el centro', async () => {
    mount(2026);
    h.http.expectOne((r) => r.url === url).flush(BREAKDOWN);
    await settle();
    h.fixture.detectChanges();

    const labels = Array.from(h.el.querySelectorAll('.donut__label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Personal', 'Mantenimiento', 'Otros']);
    expect(h.el.querySelector('.donut__total')?.textContent).toMatch(/5\.200\s?€/);
    expect(h.el.querySelector('.donut__percent')?.textContent?.trim()).toBe('58 %');
  });

  it('cada categoría conserva su color fijo aunque cambie el ranking', async () => {
    mount(2026);
    h.http.expectOne((r) => r.url === url).flush(BREAKDOWN);
    await settle();
    h.fixture.detectChanges();
    const fills = Array.from(h.el.querySelectorAll<SVGPathElement>('.donut__slice')).map((p) => p.style.fill);
    expect(fills).toEqual(['var(--chart-3)', 'var(--chart-1)', 'var(--chart-6)']); // personal, mantenimiento, otros
  });

  it('al cambiar el ejercicio recarga y conserva el reparto anterior atenuado mientras llega', async () => {
    mount(2026);
    h.http.expectOne((r) => r.url === url).flush(BREAKDOWN);
    await settle();
    h.fixture.detectChanges();

    h.fixture.componentRef.setInput('year', 2025);
    h.fixture.detectChanges();
    expect(h.el.querySelector('.breakdown__body')?.classList.contains('breakdown__body--loading')).toBe(true);
    expect(h.el.querySelector('app-donut-chart')).not.toBeNull();
    const req = h.http.expectOne((r) => r.url === url);
    expect(req.request.params.get('year')).toBe('2025');
    req.flush({ year: 2025, total: 0, categories: [] });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.chart__empty')?.textContent).toContain('Todavía no hay gastos');
  });

  it('si falla la carga muestra un aviso; si falla un cambio de año conserva el último reparto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(2026);
    h.http.expectOne((r) => r.url === url).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
    expect(h.el.querySelector('app-donut-chart')).toBeNull();

    h.fixture.componentRef.setInput('year', 2025);
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === url).flush(BREAKDOWN);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-donut-chart')).not.toBeNull();

    h.fixture.componentRef.setInput('year', 2024);
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === url).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-donut-chart')).not.toBeNull();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('último ejercicio');
  });
});
