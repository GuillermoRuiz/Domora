import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { EstateDashboardService } from './estate-dashboard.service';
import type { EstateDashboardSummary } from './estate-dashboard.models';

describe('EstateDashboardService', () => {
  let h: ApiServiceHarness<EstateDashboardService>;

  beforeEach(() => {
    h = setupApiService(EstateDashboardService);
  });

  afterEach(() => h.http.verify());

  it('getSummary pide el resumen de la finca y devuelve el cuerpo tal cual', async () => {
    const body: EstateDashboardSummary = {
      estateId: 'e1', units: 24, balance: 12450,
      pendingDues: { amount: 1250, properties: 2 },
      issues: { open: 2, thisYear: 12 },
      nextMeeting: { id: 'm1', title: 'Junta ordinaria', type: 'ordinaria', scheduledAt: '2026-03-15T18:00:00.000Z' },
    };
    const promise = h.service.getSummary('e1');
    const req = h.http.expectOne(`${API}/estates/e1/dashboard/summary`);
    expect(req.request.method).toBe('GET');
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('getCashflow sin año no manda parámetros; con año lo manda como query', async () => {
    const body = { year: 2026, years: [2025, 2026], months: [] };
    let promise = h.service.getCashflow('e1');
    let req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/cashflow`);
    expect(req.request.params.keys()).toEqual([]);
    req.flush(body);
    expect(await promise).toEqual(body);

    promise = h.service.getCashflow('e1', 2025);
    req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/cashflow`);
    expect(req.request.params.get('year')).toBe('2025');
    req.flush({ ...body, year: 2025 });
    expect((await promise).year).toBe(2025);
  });

  it('getExpenseBreakdown pide el reparto del ejercicio indicado', async () => {
    const body = { year: 2025, total: 100, categories: [{ key: 'staff', label: 'Personal', amount: 100 }] };
    const promise = h.service.getExpenseBreakdown('e1', 2025);
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/expense-breakdown`);
    expect(req.request.params.get('year')).toBe('2025');
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('getMilestones pide los hitos de la finca', async () => {
    const body = { items: [{ key: 'meeting:m1', kind: 'meeting', title: 'Junta ordinaria', date: '2026-03-15T18:00:00.000Z', overdue: false }] };
    const promise = h.service.getMilestones('e1');
    const req = h.http.expectOne(`${API}/estates/e1/dashboard/milestones`);
    expect(req.request.method).toBe('GET');
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('getActivity pide la actividad de la finca, con límite opcional', async () => {
    let promise = h.service.getActivity('e1');
    let req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/activity`);
    expect(req.request.params.has('limit')).toBe(false);
    req.flush({ items: [] });
    expect(await promise).toEqual({ items: [] });

    promise = h.service.getActivity('e1', 3);
    req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/activity`);
    expect(req.request.params.get('limit')).toBe('3');
    req.flush({ items: [] });
    await promise;
  });

  it('getActivity puede pedir solo ciertos tipos de actividad', async () => {
    const promise = h.service.getActivity('e1', 5, ['property', 'membership']);
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/activity`);
    expect(req.request.params.get('limit')).toBe('5');
    expect(req.request.params.get('subjects')).toBe('property,membership');
    req.flush({ items: [] });
    expect(await promise).toEqual({ items: [] });
  });

  it('getRecentProperties pide las últimas propiedades de la finca', async () => {
    const body = { total: 40, items: [] };
    const promise = h.service.getRecentProperties('e1');
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/properties`);
    expect(req.request.params.has('limit')).toBe(false);
    req.flush(body);
    expect(await promise).toEqual(body);
  });

  it('getPropertyStatuses pide el estado de pago de todas las propiedades', async () => {
    const body = { items: [{ propertyId: 'p1', balance: 10, openIssues: 0, status: 'overdue' }] };
    const promise = h.service.getPropertyStatuses('e1');
    h.http.expectOne(`${API}/estates/e1/dashboard/property-statuses`).flush(body);
    expect(await promise).toEqual(body);
  });
});
