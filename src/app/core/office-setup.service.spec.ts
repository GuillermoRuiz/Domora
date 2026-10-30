import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { OfficeSetupService, pendingOfficeSteps, type OfficeCompletenessDetail } from './office-setup.service';

const officeDetail = (over: Partial<OfficeCompletenessDetail> = {}): OfficeCompletenessDetail => ({
  administratorId: 'a1',
  name: 'Despacho Ruiz',
  office: 60,
  estates: 50,
  total: 55,
  estateCount: 1,
  onboardingComplete: false,
  includedInAverage: true,
  officeSteps: [
    { key: 'contact', weight: 'recommended', status: 'pending' },
    { key: 'billing', weight: 'required', status: 'done' },
    { key: 'payment', weight: 'required', status: 'pending' },
    { key: 'estates', weight: 'required', status: 'done', done: 1 },
    { key: 'team', weight: 'info', status: 'pending' },
    { key: 'twoFactor', weight: 'recommended', status: 'done' },
  ],
  estateDetails: [],
  ...over,
});

describe('OfficeSetupService', () => {
  let h: ApiServiceHarness<OfficeSetupService>;

  beforeEach(() => {
    h = setupApiService(OfficeSetupService);
  });

  afterEach(() => h.http.verify());

  it('getOwn pide la puesta en marcha del despacho propio (rol B)', async () => {
    const promise = h.service.getOwn();
    h.http.expectOne(`${API}/completeness/office`).flush(officeDetail());
    expect((await promise).name).toBe('Despacho Ruiz');
  });

  it('listOffices y getOffice son las vistas del rol A', async () => {
    const list = h.service.listOffices();
    h.http.expectOne(`${API}/completeness/offices`).flush({ average: 55, offices: [] });
    expect((await list).average).toBe(55);
    const one = h.service.getOffice('a1');
    h.http.expectOne(`${API}/completeness/offices/a1`).flush(officeDetail());
    expect((await one).administratorId).toBe('a1');
  });
});

describe('pendingOfficeSteps', () => {
  it('cuenta solo los obligatorios y recomendados que faltan; los informativos no', () => {
    expect(pendingOfficeSteps(officeDetail().officeSteps)).toBe(2);
    expect(pendingOfficeSteps(officeDetail().officeSteps.map((s) => (s.weight === 'info' ? s : { ...s, status: 'done' as const })))).toBe(0);
  });
});
