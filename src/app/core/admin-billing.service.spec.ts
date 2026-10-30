import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { AdminBillingService } from './admin-billing.service';

const rawOwn = {
  billing: { businessName: 'Fincas S.L.', cif: 'B12345674', address: 'Calle 1', email: 'f@test.local', paymentMethod: 'Domiciliacion', ibanMasked: 'ES91 ···· 1332' },
  mandate: null,
  sepa: { available: true, creditorId: 'ES11ZZZB12345674', creditorName: 'Domora', mandateReference: 'DOM-1-2-3', mandateText: 'Orden' },
};

describe('AdminBillingService', () => {
  let h: ApiServiceHarness<AdminBillingService>;

  beforeEach(() => {
    h = setupApiService(AdminBillingService);
  });

  afterEach(() => h.http.verify());

  it('getOwn pide los datos de facturación del despacho propio y traduce el método de pago', async () => {
    const promise = h.service.getOwn();
    h.http.expectOne(`${API}/admin-billing/me`).flush(rawOwn);
    const own = await promise;
    expect(own.billing?.paymentMethod).toBe('Domiciliación');
    expect(own.billing?.ibanMasked).toBe('ES91 ···· 1332');
  });

  it('updateOwn envía el método de pago con el valor de la API y sin id de despacho', async () => {
    const promise = h.service.updateOwn({
      businessName: 'Fincas S.L.',
      cif: 'B12345674',
      address: 'Calle 1',
      email: 'f@test.local',
      paymentMethod: 'Domiciliación',
      iban: 'ES9121000418450200051332',
      mandate: { accepted: true, reference: 'DOM-1-2-3', debtorName: 'Fincas S.L.' },
    });
    const req = h.http.expectOne(`${API}/admin-billing/me`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.paymentMethod).toBe('Domiciliacion');
    expect(req.request.body.administratorId).toBeUndefined();
    expect(req.request.body.mandate).toEqual({ accepted: true, reference: 'DOM-1-2-3', debtorName: 'Fincas S.L.' });
    req.flush(rawOwn);
    expect((await promise).billing?.paymentMethod).toBe('Domiciliación');
  });

  it('listMandates es la vista del rol A de los mandatos de un despacho', async () => {
    const promise = h.service.listMandates('a1');
    h.http.expectOne(`${API}/admin-billing/a1/sepa-mandates`).flush([]);
    expect(await promise).toEqual([]);
  });
});
