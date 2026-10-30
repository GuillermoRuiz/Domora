import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { AdminInsightsService } from './admin-insights.service';

const rawOffice = {
  administratorId: 'ad1', name: 'Fincas García', plan: 'STANDARD', createdAt: '2026-01-10T00:00:00.000Z',
  clientStatus: 'Activo', paymentStatus: 'Vencido', completeness: '62.5', salud: '55.6', atRisk: true,
  motivo: { code: 'payment', label: 'Pagos pendientes' },
  signals: [{ key: 'payment', score: 0, weight: 40, deduction: '44.4', available: true }],
  usage: { activeDays: 3, activeUsers: 1, staffUsers: 2, observedDays: 30 },
  attention: [{ code: 'overdue_payment', label: 'Pagos vencidos', severity: 3 }],
};

describe('AdminInsightsService', () => {
  let h: ApiServiceHarness<AdminInsightsService>;

  beforeEach(() => {
    h = setupApiService(AdminInsightsService);
  });

  afterEach(() => h.http.verify());

  it('healthOverview reads GET /client-health/offices and casts the numbers', async () => {
    const promise = h.service.healthOverview();
    const req = h.http.expectOne(`${API}/client-health/offices`);
    expect(req.request.method).toBe('GET');
    req.flush({ atRiskBelow: 70, churnRisk: 1, offices: [rawOffice] });
    const overview = await promise;
    expect(overview.atRiskBelow).toBe(70);
    expect(overview.offices[0].salud).toBe(55.6);
    expect(overview.offices[0].completeness).toBe(62.5);
    expect(overview.offices[0].signals[0].deduction).toBe(44.4);
    expect(overview.offices[0].createdAt).toBe('2026-01-10');
  });

  it('healthOverview keeps a null salud (Cancelado) as null', async () => {
    const promise = h.service.healthOverview();
    h.http.expectOne(`${API}/client-health/offices`).flush({
      atRiskBelow: 70, churnRisk: 0, offices: [{ ...rawOffice, salud: null, atRisk: false, motivo: null }],
    });
    expect((await promise).offices[0].salud).toBeNull();
  });

  it('officeHealth reads GET /client-health/offices/:id', async () => {
    const promise = h.service.officeHealth('ad1');
    h.http.expectOne(`${API}/client-health/offices/ad1`).flush(rawOffice);
    const office = await promise;
    expect(office.atRisk).toBe(true);
    expect(office.motivo?.label).toBe('Pagos pendientes');
    expect(office.attention).toHaveLength(1);
  });

  it('officeCompleteness reads GET /completeness/offices/:id', async () => {
    const promise = h.service.officeCompleteness('ad1');
    h.http.expectOne(`${API}/completeness/offices/ad1`).flush({
      administratorId: 'ad1', name: 'Fincas García', office: 50, estates: 75, total: 62.5, estateCount: 1,
      onboardingComplete: false, includedInAverage: true, officeSteps: [], estateDetails: [],
    });
    expect((await promise).total).toBe(62.5);
  });
});
