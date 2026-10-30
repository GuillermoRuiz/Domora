import { setupComponent } from '../../../core/testing/component-harness';
import type { ManagerKpis } from '../../../core/manager-overview.models';
import { changeTone, formatChange } from '../overview-format';
import { OverviewKpisComponent } from './overview-kpis.component';

const kpis: ManagerKpis = {
  estateId: null,
  generatedAt: '2026-10-18T10:00:00Z',
  estates: { value: 10, previous: 8, change: { type: 'percent', value: 25 } },
  activeIssues: { value: 6, previous: 9, change: { type: 'percent', value: -33.3 } },
  pendingDues: { value: 55477.57, previous: 40000, change: { type: 'percent', value: 38.7 } },
  pendingRequests: { value: 4, previous: 0, change: { type: 'new' } },
  upcomingMeetings: { value: 5, previous: 5, change: { type: 'percent', value: 0 } },
};

describe('formato y color de las variaciones', () => {
  it('«nuevo», porcentaje con signo y 0 %', () => {
    expect(formatChange({ type: 'new' })).toBe('nuevo');
    expect(formatChange({ type: 'percent', value: 12.5 })).toBe('+12,5 %');
    expect(formatChange({ type: 'percent', value: -33.3 })).toBe('−33,3 %');
    expect(formatChange({ type: 'percent', value: 0 })).toBe('0 %');
  });
  it('bajar es bueno en incidencias, solicitudes y cuotas; subir es bueno en el resto', () => {
    expect(changeTone({ type: 'percent', value: -10 }, 'down')).toBe('positive');
    expect(changeTone({ type: 'percent', value: 10 }, 'down')).toBe('danger');
    expect(changeTone({ type: 'percent', value: 10 }, 'up')).toBe('positive');
    expect(changeTone({ type: 'percent', value: -10 }, 'up')).toBe('danger');
    expect(changeTone({ type: 'new' }, 'down')).toBe('danger');
    expect(changeTone({ type: 'new' }, 'up')).toBe('positive');
    expect(changeTone({ type: 'percent', value: 0 }, 'down')).toBe('neutral');
  });
});

describe('OverviewKpisComponent', () => {
  it('pinta las cinco fichas con su valor, variación y color', () => {
    const h = setupComponent(OverviewKpisComponent);
    h.fixture.componentRef.setInput('kpis', kpis);
    h.fixture.detectChanges();
    const tile = (key: string) => h.el.querySelector(`[data-kpi="${key}"]`) as HTMLElement;
    expect(h.el.querySelectorAll('[data-kpi]')).toHaveLength(5);
    expect(tile('estates').textContent).toContain('Fincas gestionadas');
    expect(tile('estates').textContent).toContain('+25 %');
    expect(tile('estates').querySelector('.kpi__change--positive')).not.toBeNull();
    expect(tile('activeIssues').textContent).toContain('−33,3 %');
    expect(tile('activeIssues').querySelector('.kpi__change--positive')).not.toBeNull(); // bajar es bueno
    expect(tile('pendingDues').textContent).toMatch(/55\.478/);
    expect(tile('pendingDues').querySelector('.kpi__change--danger')).not.toBeNull(); // subir es malo
    expect(tile('pendingRequests').textContent).toContain('nuevo');
    expect(tile('pendingRequests').querySelector('.kpi__change--danger')).not.toBeNull();
    expect(tile('upcomingMeetings').textContent).toContain('0 %');
    expect(tile('upcomingMeetings').querySelector('.kpi__change--neutral')).not.toBeNull();
  });

  it('sin datos muestra guiones, y si falla ofrece reintentar', () => {
    const h = setupComponent(OverviewKpisComponent);
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).toContain('—');
    const retry = vi.fn();
    h.fixture.componentRef.setInput('error', true);
    h.fixture.componentRef.setInput('retry', retry);
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role=alert]')?.textContent).toContain('No se pudieron cargar');
    (h.el.querySelector('.kpis-error__retry') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
