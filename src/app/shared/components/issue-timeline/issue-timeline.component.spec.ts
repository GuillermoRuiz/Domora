import { TestBed } from '@angular/core/testing';
import { IssueTimelineComponent, type TimelineItem } from './issue-timeline.component';

const ENTRIES: TimelineItem[] = [
  { id: 't1', date: '2026-10-20T08:30:00.000Z', author: 'Ana López', role: 'Propietario', text: 'Hay una gotera en el garaje.', fromStatus: null, toStatus: null },
  { id: 't2', date: '2026-10-21T09:00:00.000Z', author: 'Gestoría Norte', role: 'Administrador', text: 'Enviamos al fontanero.', fromStatus: 'Abierta', toStatus: 'EnReparacion' },
];

describe('IssueTimelineComponent', () => {
  function setup(inputs: { entries?: TimelineItem[]; pending?: { title: string; text: string } | null; statusLabel?: (s: string) => string } = {}) {
    TestBed.configureTestingModule({ imports: [IssueTimelineComponent] });
    const fixture = TestBed.createComponent(IssueTimelineComponent);
    fixture.componentRef.setInput('entries', inputs.entries ?? ENTRIES);
    if (inputs.pending !== undefined) fixture.componentRef.setInput('pending', inputs.pending);
    if (inputs.statusLabel) fixture.componentRef.setInput('statusLabel', inputs.statusLabel);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders each entry in order with its author, role, date and text', () => {
    const el = setup();
    const items = el.querySelectorAll('[data-entry]');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('[data-author]')?.textContent).toContain('Ana López');
    expect(items[0].querySelector('.timeline__role')?.textContent).toContain('Propietario');
    expect(items[0].querySelector('time')?.textContent).toContain('20 oct 2026');
    expect(items[0].querySelector('.timeline__text')?.textContent).toContain('Hay una gotera en el garaje.');
    expect(items[1].querySelector('[data-author]')?.textContent).toContain('Gestoría Norte');
  });

  it('shows a status change with the labels given by the caller', () => {
    const labels: Record<string, string> = { Abierta: 'Abierta', EnReparacion: 'En curso' };
    const el = setup({ statusLabel: (s) => labels[s] ?? s });
    expect(el.querySelectorAll('[data-status-change]').length).toBe(1);
    expect(el.querySelector('[data-status-change]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Abierta → En curso');
  });

  it('adds a trailing hollow pending node only when asked', () => {
    expect(setup().querySelector('[data-pending]')).toBeNull();
    TestBed.resetTestingModule();
    const el = setup({ pending: { title: 'Pendiente de actualización', text: 'Te notificaremos cualquier novedad' } });
    const pending = el.querySelector('[data-pending]');
    expect(pending?.textContent).toContain('Pendiente de actualización');
    expect(pending?.textContent).toContain('Te notificaremos cualquier novedad');
    expect(el.querySelector('ol')?.lastElementChild).toBe(pending);
  });
});
