import { TestBed } from '@angular/core/testing';
import { IssuesListComponent, type IssuesListQuery } from './issues-list.component';
import type { OperationPage, OperationRow } from '../../../core/operations.service';
import type { IssueSituationView } from '../../../core/issue-workflow.models';
import { settle } from '../../../core/testing/component-harness';

const view = (over: Partial<IssueSituationView> = {}): IssueSituationView => ({
  issueId: 'i1',
  situation: 'waiting_third_party',
  label: 'Esperando tercero',
  nextStep: {
    kind: 'waiting',
    code: 'wait:insurer',
    headline: 'Esperando',
    label: 'Realizar visita del perito desde el 12 mar',
  },
  ballInCourt: {
    primary: 'insurer',
    holders: [{ party: 'insurer', label: 'Mapfre', source: 'wait', since: null, dueAt: null, refId: 'w1' }],
  },
  attention: { count: 0, tasks: [] },
  ...over,
});
const row = (over: Partial<OperationRow> = {}): OperationRow =>
  ({
    id: 'i1',
    ref: 'INC-2024-0087',
    title: 'Humedad en portal principal',
    description: 'Filtraciones en pared del portal',
    estate: { id: 'e1', name: 'C. Mayor 123', location: 'Madrid', address: 'Mayor' },
    date: '2024-03-12',
    status: 'Abierta',
    statusLabel: 'Abierta',
    situation: view(),
    ...over,
  }) as OperationRow;
const page = (items: OperationRow[] = [row()]): OperationPage => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 12,
  summary: { all: 24, attention: 5, waiting: 6, resolved: 6 },
});
const query = (over: Partial<IssuesListQuery> = {}): IssuesListQuery => ({
  search: '',
  filter: 'all',
  sort: 'newest',
  estateId: '',
  status: '',
  situation: '',
  ball: '',
  created: '',
  assetId: '',
  ...over,
});

describe('IssuesListComponent', () => {
  async function setup(data = page(), q = query()) {
    const fixture = TestBed.createComponent(IssuesListComponent);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('query', q);
    fixture.componentRef.setInput('pageCount', 1);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const events = {
      query: [] as unknown[],
      opened: [] as OperationRow[],
      status: [] as unknown[],
      cleared: 0,
    };
    fixture.componentInstance.queryChange.subscribe((v) => events.query.push(v));
    fixture.componentInstance.opened.subscribe((v) => events.opened.push(v));
    fixture.componentInstance.statusChanged.subscribe((v) => events.status.push(v));
    fixture.componentInstance.cleared.subscribe(() => events.cleared++);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, events };
  }

  it('shows the four work cards with the scope-wide counts and highlights the active one', async () => {
    const { el } = await setup(page(), query({ filter: 'attention' }));
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.card'));
    expect(cards.map((c) => c.querySelector('strong')?.textContent?.trim())).toEqual(['24', '5', '6', '6']);
    expect(cards.map((c) => c.querySelector('.card__label')?.textContent?.trim())).toEqual([
      'Todas',
      'Requieren atención',
      'Esperando tercero',
      'Resueltas',
    ]);
    expect(cards.filter((c) => c.classList.contains('card--active')).map((c) => c.dataset['filter'])).toEqual(['attention']);
  });

  it('reads each row as code, title, community, status, who holds the ball and when it was created', async () => {
    const { el } = await setup();
    const cells = Array.from(el.querySelectorAll('tbody tr td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(el.querySelectorAll('thead th')).toHaveLength(7);
    expect(cells[0]).toBe('INC-2024-0087');
    expect(cells[1]).toContain('Humedad en portal principal');
    expect(cells[1]).toContain('Filtraciones en pared del portal');
    expect(cells[2]).toBe('C. Mayor 123');
    expect(cells[3]).toBe('Abierta');
    expect(cells[4]).toBe('SeguroMapfre');
    expect(cells[5]).toContain('12 mar 2024');
  });

  it('shows only the first line of the description, on one line', async () => {
    const { el, fixture } = await setup(page([row({ description: 'Primera línea\nSegunda línea\n\nTercera' })]));
    expect(el.querySelector('.row-description')?.textContent?.trim()).toBe('Primera línea');
    expect(fixture.componentInstance.firstLine('\n  \nHola\nAdiós')).toBe('Hola');
    expect(fixture.componentInstance.firstLine(null)).toBe('');
    expect(el.querySelector('[data-location]')).toBeNull();
    // La comunidad va sola, sin la ciudad debajo.
    expect(el.querySelectorAll('tbody tr td')[2].querySelector('.row-sub')).toBeNull();
  });

  it('says the administration holds the ball when the issue needs attention', async () => {
    const attention = view({
      situation: 'requires_attention',
      label: 'Requiere atención',
      ballInCourt: {
        primary: 'administration',
        holders: [{ party: 'administration', label: 'Elegir proveedor — #INC-1', source: 'task', since: null, dueAt: null, refId: 't1' }],
      },
      nextStep: { kind: 'human', code: 'human_task', headline: 'x', label: 'Elegir proveedor — #INC-1' },
      attention: {
        count: 1,
        tasks: [{ id: 't1', title: 'Elegir proveedor — #INC-1', kind: null, priority: 'Normal', dueAt: '2026-10-30', overdue: false, route: '/b/tasks?task=t1' }],
      },
    });
    const { el } = await setup(page([row({ situation: attention })]));
    // Administración tiene la pelota: no se repite el título de la tarea como si fuera un tercero.
    expect(el.querySelector('.ball')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Administración');
  });

  it('counts the other holders of the ball', async () => {
    const two = view({
      ballInCourt: {
        primary: 'provider',
        holders: [
          { party: 'provider', label: 'Fontanería', source: 'visit', since: null, dueAt: null, refId: 'v1' },
          { party: 'insurer', label: 'Mapfre', source: 'wait', since: null, dueAt: null, refId: 'w1' },
        ],
      },
    });
    const { el } = await setup(page([row({ situation: two })]));
    expect(el.querySelector('.ball')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Proveedor+1Fontanería');
    expect(el.querySelector('.ball')?.getAttribute('title')).toBe('Proveedor · Fontanería · Seguro · Mapfre');
  });

  it('asks the page for the filter a card or a dropdown stands for', async () => {
    const { el, events, fixture } = await setup();
    el.querySelector<HTMLButtonElement>('.card[data-filter="waiting"]')!.click();
    el.querySelector<HTMLButtonElement>('.card[data-filter="all"]')!.click();
    const ball = el.querySelector<HTMLSelectElement>('select[aria-label="En manos de"]')!;
    ball.value = 'insurer';
    ball.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(events.query).toEqual([{ filter: 'waiting' }, { filter: null }, { ball: 'insurer' }]);
  });

  it('opens the issue from the row and from the menu without opening it twice', async () => {
    const { el, events, fixture } = await setup();
    el.querySelector<HTMLTableRowElement>('tbody tr')!.click();
    expect(events.opened.map((r) => r.id)).toEqual(['i1']);
    el.querySelector<HTMLButtonElement>('.row-menu__trigger')!.click();
    fixture.detectChanges();
    expect(events.opened).toHaveLength(1);
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.row-menu button'));
    items.find((b) => b.textContent?.includes('Ver expediente completo'))!.click();
    expect(events.opened).toHaveLength(2);
  });

  it('changes the status from the row menu, never to the one it already has', async () => {
    const { el, events, fixture } = await setup();
    el.querySelector<HTMLButtonElement>('.row-menu__trigger')!.click();
    fixture.detectChanges();
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.row-menu [role="menuitemradio"]'));
    expect(items.find((b) => b.textContent?.includes('Abierta'))!.disabled).toBe(true);
    items.find((b) => b.textContent?.includes('En reparación'))!.click();
    fixture.detectChanges();
    expect(events.status).toEqual([{ row: expect.objectContaining({ id: 'i1' }), status: 'En reparación' }]);
    expect(el.querySelector('.row-menu')).toBeNull();
  });

  it('only offers to clear the filters when there is something to clear', async () => {
    const idle = await setup();
    expect(idle.el.querySelector<HTMLButtonElement>('.clear')!.disabled).toBe(true);
    const busy = await setup(page(), query({ status: 'Abierta' }));
    const clear = busy.el.querySelector<HTMLButtonElement>('.clear')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(busy.events.cleared).toBe(1);
  });

  it('explains an empty result differently when filters are on', async () => {
    const none = { ...page([]), total: 0 };
    const filtered = await setup(none, query({ search: 'xyz' }));
    expect(filtered.el.querySelector('.empty-state')?.textContent).toContain('Sin resultados para estos filtros');
    const clean = await setup(none);
    expect(clean.el.querySelector('.empty-state')?.textContent).toContain('Todavía no hay incidencias');
  });

  it('names the issue state, not a location, and gives every column a title that sorts', async () => {
    const { el } = await setup();
    const heads = Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(heads).toEqual([
      'Código', 'Título', 'Comunidad / Inmueble', 'Estado', 'En manos de', 'Creado', 'Acciones',
    ]);
    expect(el.querySelectorAll('thead th button.sort')).toHaveLength(6);
    expect(el.querySelector('.location-pill')).toBeNull();
  });

  it('sorts by a title: first ascending, then descending, and reports it to the page', async () => {
    const { el, events, fixture } = await setup();
    const title = el.querySelectorAll<HTMLButtonElement>('thead th button.sort')[1];
    title.click();
    expect(events.query.at(-1)).toEqual({ sort: 'title_asc' });
    fixture.componentRef.setInput('query', query({ sort: 'title_asc' }));
    fixture.detectChanges();
    expect(el.querySelectorAll('thead th')[1].getAttribute('aria-sort')).toBe('ascending');
    title.click();
    expect(events.query.at(-1)).toEqual({ sort: 'title_desc' });
    expect(el.querySelector<HTMLSelectElement>('select[aria-label="Ordenar"]')!.textContent).toContain('Título ↑');
  });

  it('toggles the creation date between newest and oldest', async () => {
    const { el, events, fixture } = await setup();
    const age = el.querySelectorAll<HTMLButtonElement>('thead th button.sort')[5];
    age.click();
    expect(events.query.at(-1)).toEqual({ sort: 'oldest' });
    fixture.componentRef.setInput('query', query({ sort: 'oldest' }));
    fixture.detectChanges();
    age.click();
    expect(events.query.at(-1)).toEqual({ sort: null });
  });

  it('writes the creation as a date, never as "hoy" or a number of days', async () => {
    const today = new Date().toISOString();
    const { el } = await setup(page([row({ date: today })]));
    const created = el.querySelector('tbody tr td.age')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(created).toMatch(/^\d{1,2} [a-zñ]{3,4} \d{4}$/);
    expect(created).not.toMatch(/hoy|ayer|días?/i);
  });
});
