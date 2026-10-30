import { setupComponent } from '../../../core/testing/component-harness';
import type { ManagerActivityItem } from '../../../core/manager-overview.models';
import { OverviewActivityComponent, timeAgo } from './overview-activity.component';

const NOW = new Date('2026-10-18T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const item = (n: number, over: Partial<ManagerActivityItem> = {}): ManagerActivityItem => ({
  id: `a${n}`, subjectType: 'communication', verb: 'published', summary: `Comunicado ${n} publicado`, occurredAt: at(3 * 3_600_000),
  estateId: 'e1', estateName: 'Los Pinos', ...over,
});

describe('timeAgo', () => {
  it('minutos, horas, ayer, días y fecha', () => {
    expect(timeAgo(at(10_000), NOW)).toBe('ahora mismo');
    expect(timeAgo(at(5 * 60_000), NOW)).toBe('hace 5 min');
    expect(timeAgo(at(3 * 3_600_000), NOW)).toBe('hace 3 h');
    expect(timeAgo(at(30 * 3_600_000), NOW)).toBe('ayer');
    expect(timeAgo(at(4 * 86_400_000), NOW)).toBe('hace 4 días');
    expect(timeAgo(at(60 * 86_400_000), NOW)).toMatch(/\d{4}/);
  });
});

describe('OverviewActivityComponent', () => {
  it('pinta las acciones con su finca y cuándo ocurrieron; los mensajes van sin finca', () => {
    const h = setupComponent(OverviewActivityComponent);
    h.fixture.componentRef.setInput('now', NOW);
    h.fixture.componentRef.setInput('data', {
      items: [
        item(1, { subjectType: 'message', summary: 'Mensaje enviado a Marta Ruiz', estateId: null, estateName: null, occurredAt: at(2 * 3_600_000) }),
        item(2),
        item(3, { subjectType: 'supplier', summary: 'Proveedor "Fontanería" actualizado', occurredAt: at(30 * 3_600_000) }),
      ],
    });
    h.fixture.detectChanges();
    const rows = h.el.querySelectorAll('.activity__row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Mensaje enviado a Marta Ruiz');
    expect(rows[0]?.querySelector('.activity__estate')).toBeNull();
    expect(rows[0]?.querySelector('time')?.textContent?.trim()).toBe('hace 2 h');
    expect(rows[1]?.querySelector('.activity__estate')?.textContent).toContain('Los Pinos');
    expect(rows[2]?.querySelector('time')?.textContent?.trim()).toBe('ayer');
    expect(rows[2]?.getAttribute('data-subject')).toBe('supplier');
  });

  it('muestra como mucho lo que llega (5) y no ofrece «Ver todas»', () => {
    const h = setupComponent(OverviewActivityComponent);
    h.fixture.componentRef.setInput('data', { items: Array.from({ length: 5 }, (_, i) => item(i + 1)) });
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.activity__row')).toHaveLength(5);
    expect(h.el.textContent).not.toContain('Ver todas');
  });

  it('cargando, vacío y error con reintento', () => {
    const h = setupComponent(OverviewActivityComponent);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando actividad');
    h.fixture.componentRef.setInput('data', { items: [] });
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Todavía no hay actividad');
    const retry = vi.fn();
    h.fixture.componentRef.setInput('data', null);
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    (h.el.querySelector('.activity__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
