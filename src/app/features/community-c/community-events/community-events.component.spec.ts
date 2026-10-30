import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { PropertyEvent } from '../../../core/owner-community.models';
import { CommunityEventsComponent, type EventSection } from './community-events.component';

const event = (id: string, overrides: Partial<PropertyEvent> = {}): PropertyEvent => ({
  id, kind: 'junta', title: 'Junta ordinaria de propietarios', subtitle: 'Salón de la comunidad', date: '2026-10-30', time: '18:00', ...overrides,
});

describe('CommunityEventsComponent', () => {
  let h: ComponentHarness<CommunityEventsComponent>;

  function mount(events: PropertyEvent[] | null, failed = false): void {
    h = setupComponent(CommunityEventsComponent);
    h.fixture.componentRef.setInput('events', events);
    h.fixture.componentRef.setInput('failed', failed);
    h.fixture.detectChanges();
  }
  const row = (id: string) => h.el.querySelector(`[data-event="${id}"]`) as HTMLButtonElement;
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('muestra la insignia de fecha, el título y el detalle con la hora, en el orden recibido', () => {
    mount([event('junta:1'), event('recibo:1', { kind: 'recibo', title: 'Vencimiento de recibo', subtitle: 'Cuota ordinaria', date: '2026-11-05', time: null })]);
    expect(Array.from(h.el.querySelectorAll('[data-event]')).map(e => e.getAttribute('data-event'))).toEqual(['junta:1', 'recibo:1']);
    expect(text(row('junta:1').querySelector('.evt__date'))).toBe('30oct');
    expect(row('junta:1').querySelector('.evt__title')?.textContent?.trim()).toBe('Junta ordinaria de propietarios');
    expect(row('junta:1').querySelector('.evt__sub')?.textContent?.trim()).toBe('Salón de la comunidad · 18:00');
    expect(text(row('recibo:1').querySelector('.evt__date'))).toBe('5nov');
    expect(row('recibo:1').querySelector('.evt__sub')?.textContent?.trim()).toBe('Cuota ordinaria');
  });

  it('un evento sin detalle ni hora no deja una línea vacía', () => {
    mount([event('reserva:1', { kind: 'reserva', subtitle: null, time: null })]);
    expect(row('reserva:1').querySelector('.evt__sub')).toBeNull();
  });

  it('el día se lee tal cual viene, sin que la zona horaria lo corra', () => {
    mount([event('r1', { date: '2026-01-01' })]);
    expect(text(row('r1').querySelector('.evt__date'))).toBe('1ene');
  });

  it.each([
    ['junta', 'juntas'],
    ['recibo', 'receipts'],
    ['reserva', 'reservas'],
  ] as const)('un evento de «%s» lleva a la sección «%s» de la propiedad', (kind, target) => {
    mount([event('e1', { kind })]);
    const opened: EventSection[] = [];
    h.component.open.subscribe(t => opened.push(t));
    expect(row('e1').disabled).toBe(false);
    row('e1').click();
    expect(opened).toEqual([target]);
  });

  it('las revisiones de instalaciones se enseñan pero no llevan a ningún sitio', () => {
    mount([event('rev', { kind: 'revision', title: 'RITE — Sala de calderas', subtitle: 'Caldera de calefacción', time: null })]);
    const opened: EventSection[] = [];
    h.component.open.subscribe(t => opened.push(t));
    expect(row('rev').disabled).toBe(true);
    row('rev').click();
    expect(opened).toEqual([]);
    expect(row('rev').textContent).toContain('Caldera de calefacción');
  });

  it('sin eventos explica el horizonte', () => {
    mount([]);
    expect(h.el.querySelector('[data-empty]')?.textContent).toContain('No hay eventos previstos en los próximos 90 días');
  });

  it('mientras carga lo dice', () => {
    mount(null);
    expect(h.el.textContent).toContain('Cargando…');
  });

  it('si falla lo avisa', () => {
    mount(null, true);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los próximos eventos');
  });
});
