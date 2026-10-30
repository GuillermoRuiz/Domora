import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { API, makeUser, setupComponent, settle } from '../../core/testing/component-harness';
import { CommunityScopeService } from '../../core/community-scope.service';
import type { ManagerKpis, PendingItem } from '../../core/manager-overview.models';
import { greeting, OverviewBComponent } from './overview-b.component';

const kpis = (estateId: string | null, estates = 3): ManagerKpis => ({
  estateId,
  generatedAt: '2026-10-18T10:00:00Z',
  estates: { value: estates, previous: 1, change: { type: 'percent', value: 200 } },
  activeIssues: { value: 1, previous: 1, change: { type: 'percent', value: 0 } },
  pendingDues: { value: 100, previous: 100, change: { type: 'percent', value: 0 } },
  pendingRequests: { value: 0, previous: 0, change: { type: 'percent', value: 0 } },
  upcomingMeetings: { value: 0, previous: 0, change: { type: 'percent', value: 0 } },
});

const pendingItem = (over: Partial<PendingItem> = {}): PendingItem => ({
  id: 'receipt:p1', kind: 'receipt', urgency: 'urgente', title: 'Cuotas vencidas sin cobrar', detail: 'Los Pinos · 3A · 150,00 € · 70 días',
  estateId: 'e1', estateName: 'Los Pinos', date: '2026-08-10', amount: 150, safety: false,
  target: { section: 'cuotas', estateId: 'e1', refId: 'p1' }, ...over,
});

describe('greeting', () => {
  it('cambia con la hora', () => {
    expect([greeting(3), greeting(9), greeting(15), greeting(22)]).toEqual(['Buenas noches', 'Buenos días', 'Buenas tardes', 'Buenas noches']);
  });
});

describe('OverviewBComponent', () => {
  beforeEach(() => sessionStorage.clear());

  const setup = () => setupComponent(OverviewBComponent, { user: makeUser({ role: 'B', fullName: 'Marta Gómez Ruiz', administratorId: 'a1', estateIds: ['e1'] }) });
  const kpiUrl = `${API}/manager-overview/kpis`;
  const isKpis = (r: { url: string }) => r.url === kpiUrl;
  /** Responde, vacías, el resto de secciones para que cada test se centre en lo suyo. */
  const answerOthers = (h: ReturnType<typeof setup>, pending: object = { total: 0, items: [] }) => {
    for (const request of h.http.match((r) => r.url.startsWith(`${API}/manager-overview`) && !isKpis(r))) {
      request.flush(request.request.url.endsWith('/pending-today') ? pending : request.request.url.endsWith('/milestones') ? { items: [] } : request.request.url.endsWith('/performance') ? { items: [], selected: null, total: 0 } : request.request.url.endsWith('/activity') ? { items: [] } : request.request.url.endsWith('/economic-summary') ? { estateId: null, fiscalYear: null, billed: 0, collected: 0, pending: 0, treasury: 0, reserve: 0, expenses: 0 } : {});
    }
  };

  it('saluda por el nombre, muestra el ámbito global y pide los datos sin finca', async () => {
    const h = setup();
    h.fixture.detectChanges();
    const request = h.http.expectOne(isKpis);
    expect(request.request.params.has('estateId')).toBe(false);
    request.flush(kpis(null));
    answerOthers(h);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('h1')?.textContent).toMatch(/^(Buenos días|Buenas tardes|Buenas noches), Marta$/);
    expect(h.el.querySelector('.scope__label')?.textContent).toContain('Todas tus comunidades');
    expect(h.el.querySelector('.scope__info')?.getAttribute('aria-label')).toContain('ámbito');
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).toContain('3');
    h.http.verify();
  });

  it('al elegir una finca en el selector filtra en el sitio, sin navegar, y vuelve a pedir con esa finca', async () => {
    const h = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    h.http.expectOne(isKpis).flush(kpis(null));
    answerOthers(h);
    await settle();

    TestBed.inject(CommunityScopeService).remember([{ id: 'e1', name: 'Los Pinos' }]);
    TestBed.inject(CommunityScopeService).select('e1');
    h.fixture.detectChanges();
    await settle();
    const filtered = h.http.expectOne(isKpis);
    expect(filtered.request.params.get('estateId')).toBe('e1');
    const pending = h.http.expectOne((r) => r.url === `${API}/manager-overview/pending-today`);
    expect(pending.request.params.get('estateId')).toBe('e1');
    filtered.flush(kpis('e1', 1));
    pending.flush({ total: 0, items: [] });
    h.http.expectOne((r) => r.url === `${API}/manager-overview/milestones` && r.params.get('estateId') === 'e1').flush({ items: [] });
    h.http.expectOne((r) => r.url === `${API}/manager-overview/activity` && r.params.get('estateId') === 'e1').flush({ items: [] });
    h.http.expectOne((r) => r.url === `${API}/manager-overview/performance` && r.params.get('estateId') === 'e1').flush({ items: [], selected: null, total: 0 });
    h.http.expectOne((r) => r.url === `${API}/manager-overview/economic-summary` && r.params.get('estateId') === 'e1').flush({ estateId: 'e1', fiscalYear: 2026, billed: 0, collected: 0, pending: 0, treasury: 0, reserve: 0, expenses: 0 });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.scope__label')?.textContent).toContain('Los Pinos');
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).toContain('1');
    expect(navigate).not.toHaveBeenCalled();
    h.http.verify();
  });

  it('una respuesta tardía de la selección anterior no pisa a la última', async () => {
    const h = setup();
    h.fixture.detectChanges();
    const first = h.http.expectOne(isKpis);
    answerOthers(h);
    TestBed.inject(CommunityScopeService).remember([{ id: 'e1', name: 'Los Pinos' }]);
    TestBed.inject(CommunityScopeService).select('e1');
    h.fixture.detectChanges();
    await settle();
    const second = h.http.expectOne((r) => isKpis(r) && r.params.get('estateId') === 'e1');
    second.flush(kpis('e1', 1));
    answerOthers(h);
    await settle();
    first.flush(kpis(null, 99));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).toContain('1');
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).not.toContain('99');
  });

  it('si fallan los indicadores ofrece reintentar y al pulsarlo SOLO los vuelve a pedir', async () => {
    const h = setup();
    h.fixture.detectChanges();
    h.http.expectOne(isKpis).flush({}, { status: 500, statusText: 'Error' });
    answerOthers(h);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.kpis-error')).not.toBeNull();
    (h.el.querySelector('.kpis-error__retry') as HTMLButtonElement).click();
    h.http.expectOne(isKpis).flush(kpis(null));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.kpis-error')).toBeNull();
    expect(h.el.querySelector('[data-kpi="estates"]')?.textContent).toContain('3');
    h.http.verify();
  });

  it('una fila de «Pendientes de hoy» lleva a la gestión que la resuelve', async () => {
    const h = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    h.http.expectOne(isKpis).flush(kpis(null));
    answerOthers(h, {
      total: 2,
      items: [pendingItem(), pendingItem({ id: 'contract:c1', kind: 'contract', title: 'Contrato de Ascensores por vencer', target: { section: 'proveedores', estateId: 'e1', refId: 'c1' } })],
    });
    await settle();
    h.fixture.detectChanges();
    const rows = h.el.querySelectorAll<HTMLButtonElement>('.pending__row');
    expect(rows).toHaveLength(2);
    rows[0]!.click();
    expect(navigate).toHaveBeenCalledWith(['/b/accounting', 'e1'], undefined);
    rows[1]!.click();
    expect(navigate).toHaveBeenLastCalledWith(['/b/estates', 'e1'], { queryParams: { tab: 'contracts' } });
  });

  it('elegir una comunidad en el ranking cambia la selección como el selector de la cabecera y «Ver todas» va a Fincas', async () => {
    const h = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    h.http.expectOne(isKpis).flush(kpis(null));
    const row = { rank: 1, estateId: 'e1', name: 'Los Pinos', color: null, billed: 1000, incidents: 0, status: 'al_dia' };
    answerOthers(h);
    await settle();
    h.fixture.detectChanges();

    h.component.pickEstate(row as never);
    expect(TestBed.inject(CommunityScopeService).selected()).toEqual({ id: 'e1', name: 'Los Pinos' });
    expect(navigate).not.toHaveBeenCalled();
    h.fixture.detectChanges();
    await settle();
    // La selección vuelve a pedir los datos filtrados (incluido el ranking, que señala la finca).
    expect(h.http.match((r) => r.url === `${API}/manager-overview/performance` && r.params.get('estateId') === 'e1')).toHaveLength(1);

    h.component.openEstates();
    expect(navigate).toHaveBeenCalledWith(['/b/estates']);
  });
});
