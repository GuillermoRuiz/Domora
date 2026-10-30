import { setupComponent } from '../../../core/testing/component-harness';
import type { PendingItem, PendingToday } from '../../../core/manager-overview.models';
import { overviewRoute } from '../overview-routes';
import { OverviewPendingComponent } from './overview-pending.component';

const item = (n: number, over: Partial<PendingItem> = {}): PendingItem => ({
  id: `receipt:${n}`, kind: 'receipt', urgency: 'urgente', title: `Cuotas vencidas ${n}`, detail: 'Los Pinos', estateId: 'e1', estateName: 'Los Pinos',
  date: '2026-08-10', amount: 100, safety: false, target: { section: 'cuotas', estateId: 'e1', refId: `p${n}` }, ...over,
});

describe('overviewRoute', () => {
  it('cada tipo lleva a la gestión que ya existe', () => {
    expect(overviewRoute('receipt', 'e1')).toEqual({ commands: ['/b/accounting', 'e1'] });
    expect(overviewRoute('installation', 'e1')).toEqual({ commands: ['/b/estates', 'e1'], queryParams: { tab: 'amenities' } });
    expect(overviewRoute('inspection', 'e1').queryParams).toEqual({ tab: 'inspections' });
    expect(overviewRoute('contract', 'e1').queryParams).toEqual({ tab: 'contracts' });
    expect(overviewRoute('adhesion', 'e1').queryParams).toEqual({ tab: 'requests' });
    expect(overviewRoute('meeting', 'e1').queryParams).toEqual({ tab: 'juntas' });
  });
});

describe('OverviewPendingComponent', () => {
  it('el número de la cabecera es el total aunque solo vengan algunas filas, y las filas llevan su etiqueta', () => {
    const h = setupComponent(OverviewPendingComponent);
    const data: PendingToday = {
      total: 14,
      items: [item(1), item(2, { urgency: 'hoy' }), item(3, { urgency: 'esta_semana', kind: 'adhesion' })],
    };
    h.fixture.componentRef.setInput('data', data);
    h.fixture.detectChanges();
    expect(h.el.querySelector('.pending__count')?.textContent?.trim()).toBe('14');
    const rows = h.el.querySelectorAll('.pending__row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Urgente');
    expect(rows[1]?.textContent).toContain('Hoy');
    expect(rows[2]?.textContent).toContain('Esta semana');
  });

  it('con más de 6 filas la lista hace scroll en lugar de crecer', () => {
    const h = setupComponent(OverviewPendingComponent);
    h.fixture.componentRef.setInput('data', { total: 9, items: Array.from({ length: 9 }, (_, i) => item(i + 1)) });
    h.fixture.detectChanges();
    const list = h.el.querySelector('.pending') as HTMLElement;
    expect(list.querySelectorAll('li')).toHaveLength(9);
    expect(getComputedStyle(list).overflowY).toBe('auto');
  });

  it('emite la fila pulsada', () => {
    const h = setupComponent(OverviewPendingComponent);
    h.fixture.componentRef.setInput('data', { total: 1, items: [item(1)] });
    h.fixture.detectChanges();
    const opened: PendingItem[] = [];
    h.component.open.subscribe((i) => opened.push(i));
    (h.el.querySelector('.pending__row') as HTMLButtonElement).click();
    expect(opened.map((i) => i.id)).toEqual(['receipt:1']);
  });

  it('sin pendientes lo dice; cargando y con error también', () => {
    const h = setupComponent(OverviewPendingComponent);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando pendientes');
    h.fixture.componentRef.setInput('data', { total: 0, items: [] });
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('nada pendiente');
    const retry = vi.fn();
    h.fixture.componentRef.setInput('data', null);
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role=alert]')).not.toBeNull();
    (h.el.querySelector('.pending__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
