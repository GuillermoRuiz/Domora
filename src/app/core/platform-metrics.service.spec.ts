import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { PlatformMetricsService } from './platform-metrics.service';

describe('PlatformMetricsService', () => {
  let h: ApiServiceHarness<PlatformMetricsService>;

  beforeEach(() => {
    h = setupApiService(PlatformMetricsService);
  });

  afterEach(() => h.http.verify());

  it('mrr pide el MRR de la plataforma y convierte a número los importes que llegan como texto', async () => {
    const promise = h.service.mrr();
    h.http.expectOne(`${API}/platform-metrics/mrr`).flush({
      currentMrr: '1250.5',
      payingClients: 3,
      dataSince: '2026-09',
      months: [{
        month: '2026-10',
        mrr: '1200',
        payingClients: 3,
        movements: { new: '49', expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 49, signups: 1, cancellations: 0 },
      }],
    });
    const mrr = await promise;
    expect(mrr.currentMrr).toBe(1250.5);
    expect(mrr.months[0].mrr).toBe(1200);
    expect(mrr.months[0].movements.new).toBe(49);
    expect(mrr.dataSince).toBe('2026-09');
  });

  it('activity pide los últimos eventos de negocio con el límite indicado', async () => {
    const promise = h.service.activity(8);
    const req = h.http.expectOne(r => r.url === `${API}/platform-metrics/activity`);
    expect(req.request.params.get('limit')).toBe('8');
    req.flush([{ id: 'e1', type: 'signup', title: 'Alta', occurredAt: '2026-10-20T10:00:00Z', administrator: { id: 'a1', name: 'Fincas Sol' } }]);
    expect((await promise)[0].administrator.name).toBe('Fincas Sol');
  });

  it('attention pide los despachos que requieren atención', async () => {
    const promise = h.service.attention();
    h.http.expectOne(`${API}/client-health/attention`).flush([{ administratorId: 'a1', name: 'Fincas Sol', reasons: [] }]);
    expect((await promise)[0].administratorId).toBe('a1');
  });

  it('clientsSummary cuenta las cuentas en prueba y suma las facturas pendientes separando las vencidas', async () => {
    const promise = h.service.clientsSummary();
    h.http.expectOne(`${API}/admins`).flush([
      { id: 'a1', clientStatus: 'En prueba', pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 } },
      { id: 'a2', clientStatus: 'Activo', pendingInvoices: { count: 3, amount: '1500.25', overdueCount: 1, overdueAmount: '600' } },
      { id: 'a3', clientStatus: 'En prueba', pendingInvoices: { count: 1, amount: 649.75, overdueCount: 1, overdueAmount: 649.75 } },
      { id: 'a4', clientStatus: 'Activo' },
    ]);
    expect(await promise).toEqual({
      trials: 2,
      pendingInvoices: { count: 4, amount: 2150, overdueCount: 2, overdueAmount: 1249.75 },
    });
  });
});
