import { setupComponent } from '../../../core/testing/component-harness';
import type { MilestoneItem } from '../../../core/manager-overview.models';
import { OverviewMilestonesComponent } from './overview-milestones.component';

const item = (n: number, over: Partial<MilestoneItem> = {}): MilestoneItem => ({
  id: `contract:${n}`, kind: 'contract', title: `Vence el contrato ${n}`, estateId: 'e1', estateName: 'Los Pinos', date: '2026-10-25',
  target: { section: 'proveedores', estateId: 'e1', refId: `c${n}` }, ...over,
});

describe('OverviewMilestonesComponent', () => {
  it('pinta día y mes, la finca, el tipo y la hora de las juntas', () => {
    const h = setupComponent(OverviewMilestonesComponent);
    h.fixture.componentRef.setInput('data', {
      items: [
        item(1, { id: 'meeting:1', kind: 'meeting', title: 'Junta ordinaria', date: '2026-10-22T17:00:00.000Z', target: { section: 'juntas', estateId: 'e1', refId: 'm1' } }),
        item(2, { id: 'inspection:2', kind: 'inspection', title: 'Inspección de ascensor · Ascensor', date: '2026-10-28', target: { section: 'instalaciones', estateId: 'e1', refId: 'i2' } }),
        item(3),
      ],
    });
    h.fixture.detectChanges();
    const rows = h.el.querySelectorAll('.milestones__row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector('.milestones__month')?.textContent?.trim()).toBe('oct');
    expect(rows[0]?.textContent).toContain('Junta ordinaria');
    expect(rows[0]?.textContent).toContain('Los Pinos');
    expect(rows[0]?.querySelector('.milestones__detail')?.textContent).toMatch(/\d{2}:\d{2}/); // las juntas llevan hora
    expect(rows[0]?.querySelector('.milestones__kind')?.textContent).toContain('Junta');
    expect(rows[1]?.querySelector('.milestones__day')?.textContent?.trim()).toBe('28');
    expect(rows[1]?.querySelector('.milestones__detail')?.textContent).not.toMatch(/\d{2}:\d{2}/); // las revisiones, solo fecha
    expect(rows[2]?.querySelector('.milestones__kind')?.textContent).toContain('Contrato');
  });

  it('con más de 6 hitos hace scroll y no hay «Ver todas»', () => {
    const h = setupComponent(OverviewMilestonesComponent);
    h.fixture.componentRef.setInput('data', { items: Array.from({ length: 9 }, (_, i) => item(i + 1)) });
    h.fixture.detectChanges();
    const list = h.el.querySelector('.milestones') as HTMLElement;
    expect(list.querySelectorAll('li')).toHaveLength(9);
    expect(getComputedStyle(list).overflowY).toBe('auto');
    expect(h.el.textContent).not.toContain('Ver todas');
  });

  it('emite el hito pulsado y cubre cargando, vacío y error con reintento', () => {
    const h = setupComponent(OverviewMilestonesComponent);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando hitos');
    h.fixture.componentRef.setInput('data', { items: [item(1)] });
    h.fixture.detectChanges();
    const opened: MilestoneItem[] = [];
    h.component.open.subscribe((i) => opened.push(i));
    (h.el.querySelector('.milestones__row') as HTMLButtonElement).click();
    expect(opened.map((i) => i.id)).toEqual(['contract:1']);

    h.fixture.componentRef.setInput('data', { items: [] });
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('próximos 30 días');

    const retry = vi.fn();
    h.fixture.componentRef.setInput('data', null);
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    (h.el.querySelector('.milestones__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
