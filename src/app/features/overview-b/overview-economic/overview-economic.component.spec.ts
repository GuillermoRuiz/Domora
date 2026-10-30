import { setupComponent } from '../../../core/testing/component-harness';
import type { EconomicSummary } from '../../../core/manager-overview.models';
import { OverviewEconomicComponent } from './overview-economic.component';

const summary = (over: Partial<EconomicSummary> = {}): EconomicSummary => ({
  estateId: null, fiscalYear: null, billed: 250_000, collected: 200_000, pending: 50_000, treasury: 80_000, reserve: 30_000, expenses: 120_000, ...over,
});

describe('OverviewEconomicComponent', () => {
  it('el anillo reparte lo facturado en cobrado y pendiente y su centro va vacío', () => {
    const h = setupComponent(OverviewEconomicComponent);
    h.fixture.componentRef.setInput('data', summary());
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.donut__slice')).toHaveLength(2);
    const legend = h.el.querySelector('.donut__legend')?.textContent ?? '';
    expect(legend).toContain('Cobrado');
    expect(legend).toContain('80 %');
    expect(legend).toContain('Pendiente');
    expect(legend).toContain('20 %');
    expect(h.el.querySelector('.donut__total')).toBeNull(); // centro sin información
    expect(h.el.querySelector('.donut__caption')).toBeNull();
  });

  it('muestra tesorería, fondo de reserva y gastos del ejercicio (no los gastos del mes)', () => {
    const h = setupComponent(OverviewEconomicComponent);
    h.fixture.componentRef.setInput('data', summary());
    h.fixture.detectChanges();
    const figure = (key: string) => h.el.querySelector(`[data-figure="${key}"]`)?.textContent ?? '';
    expect(figure('treasury')).toContain('Tesorería');
    expect(figure('treasury')).toMatch(/80\.000/);
    expect(figure('reserve')).toContain('Fondo de reserva');
    expect(figure('expenses')).toContain('Gastos del ejercicio');
    expect(h.el.textContent).not.toMatch(/Gastos del mes/i);
  });

  it('con una finca indica su ejercicio; en la vista global, el vigente de cada comunidad', () => {
    const h = setupComponent(OverviewEconomicComponent);
    h.fixture.componentRef.setInput('data', summary({ estateId: 'e1', fiscalYear: 2026 }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.economic__subtitle')?.textContent).toContain('Ejercicio 2026');
    h.fixture.componentRef.setInput('data', summary());
    h.fixture.detectChanges();
    expect(h.el.querySelector('.economic__subtitle')?.textContent).toContain('vigente de cada comunidad');
  });

  it('sin facturación dice que no hay recibos; cargando y con error ofrece reintento', () => {
    const h = setupComponent(OverviewEconomicComponent);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando resumen económico');
    h.fixture.componentRef.setInput('data', summary({ billed: 0, collected: 0, pending: 0 }));
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Todavía no hay recibos emitidos');
    const retry = vi.fn();
    h.fixture.componentRef.setInput('data', null);
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    (h.el.querySelector('.economic__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
