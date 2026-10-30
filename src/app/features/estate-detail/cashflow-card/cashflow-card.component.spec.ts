import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateCashflow } from '../../../core/estate-dashboard.models';
import { CashflowCardComponent } from './cashflow-card.component';

function cashflow(year: number, overrides: Partial<EstateCashflow> = {}): EstateCashflow {
  return {
    year,
    years: [2025, 2026],
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: i === 2 ? 12_000 : 0, expenses: i === 2 ? 8_000 : 0 })),
    ...overrides,
  };
}

describe('CashflowCardComponent', () => {
  let h: ComponentHarness<CashflowCardComponent>;
  const url = `${API}/estates/e1/dashboard/cashflow`;

  async function mount(first: EstateCashflow | { status: number }) {
    h = setupComponent(CashflowCardComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne((r) => r.url === url);
    expect(req.request.params.has('year')).toBe(false); // sin año: el servidor elige el actual
    if ('status' in first) req.flush({ message: 'x' }, { status: first.status, statusText: 'Error' });
    else req.flush(first);
    await settle();
    h.fixture.detectChanges();
  }

  afterEach(() => h.http.verify());

  it('pinta el gráfico con los doce meses y el ejercicio que devolvió el servidor', async () => {
    await mount(cashflow(2026));
    expect(h.el.querySelectorAll('app-bar-chart .chart__hit')).toHaveLength(12);
    expect(h.el.querySelector('.chart__legend')?.textContent).toContain('Ingresos');
    expect(h.el.querySelector('.chart__legend')?.textContent).toContain('Gastos');
    const select = h.el.querySelector('.cashflow__year') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['2025', '2026']);
    expect(select.value).toBe('2026');
  });

  it('ingresos y gastos usan huecos fijos de la paleta (no cambian de color entre ejercicios)', async () => {
    await mount(cashflow(2026));
    const fills = Array.from(h.el.querySelectorAll<SVGPathElement>('.chart__bar')).map((p) => p.style.fill);
    expect(new Set(fills)).toEqual(new Set(['var(--chart-1)', 'var(--chart-2)']));
  });

  it('cambiar de año pide ese ejercicio y atenúa el gráfico mientras llega', async () => {
    await mount(cashflow(2026));
    const select = h.el.querySelector('.cashflow__year') as HTMLSelectElement;
    select.value = '2025';
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();

    expect(h.el.querySelector('.cashflow__body')?.classList.contains('cashflow__body--loading')).toBe(true);
    expect(h.el.querySelector('app-bar-chart')).not.toBeNull(); // se conserva el anterior: sin salto de layout
    const req = h.http.expectOne((r) => r.url === url);
    expect(req.request.params.get('year')).toBe('2025');
    req.flush(cashflow(2025));
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('.cashflow__body')?.classList.contains('cashflow__body--loading')).toBe(false);
    expect((h.el.querySelector('.cashflow__year') as HTMLSelectElement).value).toBe('2025');
  });

  it('volver a elegir el mismo año no vuelve a pedir nada', async () => {
    await mount(cashflow(2026));
    const select = h.el.querySelector('.cashflow__year') as HTMLSelectElement;
    select.value = '2026';
    select.dispatchEvent(new Event('change'));
    h.http.expectNone((r) => r.url === url);
  });

  it('si falla la primera carga muestra un aviso y ningún gráfico', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
    expect(h.el.querySelector('app-bar-chart')).toBeNull();
  });

  it('si falla un cambio de año conserva el último gráfico y lo avisa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount(cashflow(2026));
    const select = h.el.querySelector('.cashflow__year') as HTMLSelectElement;
    select.value = '2025';
    select.dispatchEvent(new Event('change'));
    h.http.expectOne((r) => r.url === url).flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('app-bar-chart')).not.toBeNull();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('último ejercicio');
  });

  it('un ejercicio sin movimientos muestra el estado vacío del gráfico', async () => {
    await mount(cashflow(2026, { months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expenses: 0 })) }));
    expect(h.el.querySelector('.chart__empty')?.textContent).toContain('Todavía no hay ingresos ni gastos');
  });

  it('anuncia el ejercicio mostrado en cada carga (para que el reparto de gastos lo siga)', async () => {
    h = setupComponent(CashflowCardComponent);
    h.component.estateId = 'e1';
    const years: number[] = [];
    h.component.yearChange.subscribe((y) => years.push(y));
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === url).flush(cashflow(2026));
    await settle();
    h.fixture.detectChanges();

    const select = h.el.querySelector('.cashflow__year') as HTMLSelectElement;
    select.value = '2025';
    select.dispatchEvent(new Event('change'));
    h.http.expectOne((r) => r.url === url).flush(cashflow(2025));
    await settle();

    expect(years).toEqual([2026, 2025]);
  });

  it('"Ver contabilidad" emite', async () => {
    await mount(cashflow(2026));
    const spy = vi.fn();
    h.component.openAccounting.subscribe(spy);
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
