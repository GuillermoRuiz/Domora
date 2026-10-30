import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { ActivityItem } from '../../../core/models';
import { activityDayLabel, CommunityActivityComponent } from './community-activity.component';

const item = (id: string, overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id, type: 'recibo', title: 'Cuota ordinaria · Octubre 2026', description: '125 € · Pagada', date: '2026-03-12', propertyId: 'p1', ...overrides,
});

describe('activityDayLabel', () => {
  const now = new Date(2026, 9, 18, 15, 30); // 18 oct 2026, hora local

  it('«Hoy» y «Ayer» para los dos últimos días', () => {
    expect(activityDayLabel('2026-10-18', now)).toBe('Hoy');
    expect(activityDayLabel('2026-10-17T00:00:00.000Z', now)).toBe('Ayer');
  });

  it('el resto, con día, mes y año', () => {
    expect(activityDayLabel('2026-03-12', now)).toBe('12 mar 2026');
    expect(activityDayLabel('2026-10-16', now)).toBe('16 oct 2026');
  });

  it('«Ayer» funciona a primeros de mes', () => {
    expect(activityDayLabel('2026-09-30', new Date(2026, 9, 1, 9, 0))).toBe('Ayer');
  });
});

describe('CommunityActivityComponent', () => {
  let h: ComponentHarness<CommunityActivityComponent>;

  function mount(items: ActivityItem[] | null, failed = false): void {
    h = setupComponent(CommunityActivityComponent);
    h.fixture.componentRef.setInput('items', items);
    h.fixture.componentRef.setInput('failed', failed);
    h.fixture.detectChanges();
  }
  const rows = () => Array.from(h.el.querySelectorAll('[data-activity]'));
  const row = (id: string) => h.el.querySelector(`[data-activity="${id}"]`) as HTMLButtonElement;

  it('muestra título, descripción y día de cada actividad, en el orden recibido', () => {
    mount([item('a', { title: 'Fuga en el portal', description: 'Abierta', type: 'incidencia', date: '2026-03-12' }), item('b')]);
    expect(rows().map(r => r.getAttribute('data-activity'))).toEqual(['a', 'b']);
    expect(row('a').querySelector('.act__title')?.textContent?.trim()).toBe('Fuga en el portal');
    expect(row('a').querySelector('.act__desc')?.textContent?.trim()).toBe('Abierta');
    expect(row('a').querySelector('.act__when')?.textContent?.trim()).toBe('12 mar 2026');
  });

  it('enseña solo las 5 más recientes y ofrece «Ver todas»', () => {
    mount(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => item(id)));
    expect(rows()).toHaveLength(5);
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todas');
  });

  it('se pueden abrir las incidencias y los recibos con propiedad, y los documentos', () => {
    mount([
      item('inc', { type: 'incidencia' }), item('rec', { type: 'recibo' }), item('doc', { type: 'documento', propertyId: '' }),
      item('com', { type: 'comunicado', propertyId: '' }), item('sinprop', { type: 'recibo', propertyId: '' }),
    ]);
    expect(row('inc').disabled).toBe(false);
    expect(row('rec').disabled).toBe(false);
    expect(row('doc').disabled).toBe(false);
    for (const id of ['com', 'sinprop']) expect(row(id).disabled).toBe(true);
  });

  it('abrir una actividad avisa con ella', () => {
    mount([item('inc', { type: 'incidencia' })]);
    const opened: ActivityItem[] = [];
    h.component.openItem.subscribe(i => opened.push(i));
    row('inc').click();
    expect(opened.map(i => i.id)).toEqual(['inc']);
  });

  it('«Ver todas» avisa', () => {
    mount([item('a')]);
    let n = 0;
    h.component.viewAll.subscribe(() => n++);
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(n).toBe(1);
  });

  it('sin actividad lo dice y no ofrece «Ver todas»', () => {
    mount([]);
    expect(h.el.querySelector('[data-empty]')?.textContent).toContain('Todavía no hay actividad reciente');
    expect(h.el.querySelector('.section-card__action')).toBeNull();
  });

  it('mientras carga lo dice', () => {
    mount(null);
    expect(h.el.textContent).toContain('Cargando…');
  });

  it('si falla lo avisa', () => {
    mount(null, true);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar la actividad reciente');
  });
});
