import { setupComponent } from '../../../core/testing/component-harness';
import type { PerformanceRanking, PerformanceRow } from '../../../core/manager-overview.models';
import { OverviewPerformanceComponent } from './overview-performance.component';

const row = (rank: number, over: Partial<PerformanceRow> = {}): PerformanceRow => ({
  rank, estateId: `e${rank}`, name: `Comunidad ${rank}`, color: '#3F7D5C', billed: 100_000 - rank * 1_000, incidents: 0, status: 'al_dia', ...over,
});
const ranking = (over: Partial<PerformanceRanking> = {}): PerformanceRanking => ({
  items: Array.from({ length: 10 }, (_, i) => row(i + 1)), selected: null, total: 10, ...over,
});

describe('OverviewPerformanceComponent', () => {
  it('Top 10 con posición, facturado, incidencias y estado (Al día / Con incidencias)', () => {
    const h = setupComponent(OverviewPerformanceComponent);
    h.fixture.componentRef.setInput('data', ranking({ items: [row(1, { incidents: 3, status: 'con_incidencias' }), row(2)] }));
    h.fixture.detectChanges();
    const rows = h.el.querySelectorAll('.performance__row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Comunidad 1');
    expect(rows[0]?.querySelector('.performance__rank')?.textContent?.trim()).toBe('1');
    expect(rows[0]?.textContent).toMatch(/99\.000/);
    expect(rows[0]?.textContent).toContain('Con incidencias');
    expect(rows[0]?.querySelectorAll('.performance__num')[1]?.textContent?.trim()).toBe('3');
    expect(rows[1]?.textContent).toContain('Al día');
  });

  it('señala la finca elegida y no añade fila extra si ya está en el Top 10', () => {
    const h = setupComponent(OverviewPerformanceComponent);
    h.fixture.componentRef.setInput('data', ranking());
    h.fixture.componentRef.setInput('selectedId', 'e4');
    h.fixture.detectChanges();
    const selected = h.el.querySelectorAll('.performance__row--selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-estate')).toBe('e4');
    expect(selected[0]?.getAttribute('aria-current')).toBe('true');
    expect(h.el.querySelectorAll('.performance__row--extra')).toHaveLength(0);
  });

  it('si la finca elegida no está en el Top 10 se añade al final con su posición real', () => {
    const h = setupComponent(OverviewPerformanceComponent);
    h.fixture.componentRef.setInput('data', ranking({ selected: row(14), total: 14 }));
    h.fixture.componentRef.setInput('selectedId', 'e14');
    h.fixture.detectChanges();
    const rows = h.el.querySelectorAll('.performance__row');
    expect(rows).toHaveLength(11);
    const extra = rows[10] as HTMLElement;
    expect(extra.classList.contains('performance__row--extra')).toBe(true);
    expect(extra.classList.contains('performance__row--selected')).toBe(true);
    expect(extra.querySelector('.performance__rank')?.textContent?.trim()).toBe('14');
  });

  it('pulsar una comunidad emite la selección y «Ver todas» emite viewAll', () => {
    const h = setupComponent(OverviewPerformanceComponent);
    h.fixture.componentRef.setInput('data', ranking());
    h.fixture.detectChanges();
    const picked: PerformanceRow[] = [];
    let all = 0;
    h.component.pick.subscribe((r) => picked.push(r));
    h.component.viewAll.subscribe(() => (all += 1));
    (h.el.querySelector('[data-estate="e3"] .performance__name') as HTMLButtonElement).click();
    expect(picked.map((r) => r.estateId)).toEqual(['e3']);
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(all).toBe(1);
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todas');
  });

  it('cargando, vacío y error con reintento', () => {
    const h = setupComponent(OverviewPerformanceComponent);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando rendimiento');
    h.fixture.componentRef.setInput('data', ranking({ items: [], total: 0 }));
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Todavía no tienes comunidades');
    const retry = vi.fn();
    h.fixture.componentRef.setInput('data', null);
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    (h.el.querySelector('.performance__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
