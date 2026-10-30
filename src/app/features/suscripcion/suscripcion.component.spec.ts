import { API, setupComponent, settle, makeUser } from '../../core/testing/component-harness';
import { SuscripcionComponent } from './suscripcion.component';
import type { AdminInvoice, PlansCatalog } from '../../core/models';

const CATALOG: PlansCatalog = {
  prices: { BASE: 49, STANDARD: 129, PREMIUM: 249 },
  tiers: { BASE: [], STANDARD: [], PREMIUM: [] },
};

function makeSubscription(overrides: Partial<Record<string, any>> = {}): any {
  return {
    plan: 'STANDARD', tier: 'standard', status: 'Activa', blockReason: null, mrr: 129,
    discountPct: 0, endDate: '2026-12-31', usersMax: 100, usersActive: 10,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<AdminInvoice> = {}): AdminInvoice {
  return {
    id: 'inv1', no: 'F-2026-001', date: '2026-01-01', operationDate: '2026-01-01', concept: 'Cuota mensual',
    taxBase: 100, taxRate: 21, taxAmount: 21, total: 121,
    recipientName: 'Gestora Med', recipientTaxId: 'B123', recipientAddress: 'Calle X',
    status: 'Pagada',
    ...overrides,
  };
}

/**
 * ngOnInit dispara GET /estates DOS VECES en paralelo: una llamada directa
 * y otra indirecta dentro de listAccountingEstates() (que a su vez llama a
 * listEstates() antes de pedir el resumen contable de cada finca). Con 0
 * fincas, listAccountingEstates() no dispara ninguna petición adicional.
 */
async function flushInitialLoad(http: any, opts: { administratorId?: string | null; subscription?: any; invoices?: AdminInvoice[]; catalog?: PlansCatalog } = {}): Promise<void> {
  const estatesReqs = http.match((r: any) => r.url === `${API}/estates`);
  expect(estatesReqs).toHaveLength(2);
  estatesReqs.forEach((r: any) => r.flush([]));
  http.expectOne((r: any) => r.url === `${API}/plans`).flush(opts.catalog ?? CATALOG);
  http.expectOne((r: any) => r.url === `${API}/subscriptions/me`).flush(opts.subscription ?? makeSubscription());
  if (opts.administratorId) {
    http.expectOne((r: any) => r.url === `${API}/admins/${opts.administratorId}/invoices`).flush(opts.invoices ?? []);
  }
  await settle();
}

describe('SuscripcionComponent', () => {
  it('carga el uso, el plan vigente y las facturas al montar', async () => {
    const { fixture, http, el, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: 'admin1' }) });
    fixture.detectChanges();
    await flushInitialLoad(http, { administratorId: 'admin1', subscription: makeSubscription({ plan: 'STANDARD', mrr: 129 }), invoices: [makeInvoice()] });
    fixture.detectChanges();

    expect(component.currentPlanId()).toBe('STANDARD');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.textContent).toContain('F-2026-001');
  });

  it('sin administratorId, no pide facturas', async () => {
    const { fixture, http } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
    fixture.detectChanges();
    await flushInitialLoad(http);

    http.expectNone((r: any) => r.url.includes('/invoices'));
  });

  describe('banner de estado de la suscripción', () => {
    it('activa, no muestra ningún banner', async () => {
      const { fixture, http, el } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ status: 'Activa' }) });
      fixture.detectChanges();

      expect(el.querySelector('.status-banner')).toBeNull();
    });

    it('en periodo de gracia, muestra el aviso (sin tono de peligro)', async () => {
      const { fixture, http, el } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ status: 'Periodo de gracia' }) });
      fixture.detectChanges();

      const banner = el.querySelector('.status-banner');
      expect(banner).not.toBeNull();
      expect(banner?.className).not.toContain('status-banner--danger');
      expect(banner?.textContent).toContain('periodo de gracia');
    });

    it('vencida, muestra el aviso de peligro', async () => {
      const { fixture, http, el } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ status: 'Vencida' }) });
      fixture.detectChanges();

      expect(el.querySelector('.status-banner--danger')).not.toBeNull();
      expect(el.textContent).toContain('vencida');
    });

    it('bloqueada, muestra el aviso de peligro con el motivo del bloqueo', async () => {
      const { fixture, http, el } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ status: 'Bloqueada', blockReason: 'Impago reiterado' }) });
      fixture.detectChanges();

      const banner = el.querySelector('.status-banner--danger');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Impago reiterado');
    });
  });

  describe('precio total y facturación anual', () => {
    it('el toggle mensual/anual recalcula el precio base con el 20% de descuento', async () => {
      const { fixture, http, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ mrr: 129 }) });
      fixture.detectChanges();

      expect(component.basePrice()).toBe(129);

      component.setBilling('annual');
      expect(component.basePrice()).toBe(Math.round(129 * 0.8));
    });

    it('el total del mes suma el precio base y los módulos activos', async () => {
      const { fixture, http, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ mrr: 129 }) });
      fixture.detectChanges();
      const activeAddonsTotal = component.addonTotal(); // el seed trae "sms" activo por defecto

      expect(component.totalMonth()).toBe(129 + activeAddonsTotal);
    });
  });

  it('activar/desactivar un módulo adicional actualiza el total y avisa por toast con su nombre', async () => {
    const { fixture, http, el, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
    fixture.detectChanges();
    await flushInitialLoad(http, { subscription: makeSubscription({ mrr: 129 }) });
    fixture.detectChanges();
    const before = component.totalMonth();

    (Array.from(el.querySelectorAll('.addon-row')).find((r) => r.textContent?.includes('Almacenamiento adicional'))!.querySelector('.toggle') as HTMLElement).click();
    fixture.detectChanges();

    expect(component.totalMonth()).toBe(before + 5);
    expect(el.querySelector('.toast')?.textContent).toContain('"Almacenamiento adicional" activado');
  });

  describe('cambio de plan', () => {
    it('sin método de pago activo, no llama a Stripe: solo avisa que hace falta darlo de alta', async () => {
      const { fixture, http, el, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { subscription: makeSubscription({ plan: 'BASE', mrr: 49 }) }); // sin `billing` => hasActiveBilling() es false
      fixture.detectChanges();

      const premiumBtn = Array.from(el.querySelectorAll('.plan-card__btn')).find((b) => {
        const card = b.closest('.plan-card');
        return card?.textContent?.includes('Premium');
      }) as HTMLElement;
      premiumBtn.click();
      fixture.detectChanges();
      expect(el.querySelector('.modal-backdrop')).not.toBeNull();

      (Array.from(el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Confirmar cambio')) as HTMLElement).click();
      fixture.detectChanges();

      expect(component.currentPlanId()).toBe('BASE'); // sin cambios reales
      expect(el.querySelector('.modal-backdrop')).toBeNull();
      expect(el.querySelector('.toast')?.textContent).toContain('Primero tienes que dar de alta un método de pago');
      http.expectNone((r: any) => r.url.includes('/billing/'));
    });

    it('con método de pago activo, confirmar el cambio llama a POST /billing/change-plan', async () => {
      const { fixture, http, el, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: null }) });
      fixture.detectChanges();
      await flushInitialLoad(http, {
        subscription: makeSubscription({ plan: 'BASE', mrr: 49, billing: { status: 'active', currentPeriodEnd: '2026-12-31', cancelAtPeriodEnd: false } }),
      });
      fixture.detectChanges();

      const premiumBtn = Array.from(el.querySelectorAll('.plan-card__btn')).find((b) => {
        const card = b.closest('.plan-card');
        return card?.textContent?.includes('Premium');
      }) as HTMLElement;
      premiumBtn.click();
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Confirmar cambio')) as HTMLElement).click();

      const req = http.expectOne((r: any) => r.url === `${API}/billing/change-plan` && r.method === 'POST');
      expect(req.request.body).toEqual({ plan: 'PREMIUM' });
      req.flush({});
      await settle();
      await flushInitialLoad(http, { subscription: makeSubscription({ plan: 'PREMIUM', mrr: 249, billing: { status: 'active', currentPeriodEnd: '2026-12-31', cancelAtPeriodEnd: false } }) });
      fixture.detectChanges();

      expect(el.querySelector('.modal-backdrop')).toBeNull();
      expect(el.querySelector('.toast')?.textContent).toContain('Cambio a plan Premium solicitado');
    });
  });

  it('descargar una factura pide el PDF y limpia el object URL', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    try {
      const { fixture, http, component } = setupComponent(SuscripcionComponent, { user: makeUser({ administratorId: 'admin1' }) });
      fixture.detectChanges();
      await flushInitialLoad(http, { administratorId: 'admin1', invoices: [makeInvoice({ id: 'inv1' })] });
      fixture.detectChanges();

      const promise = component.downloadInvoice(component.invoices()[0]);
      const req = http.expectOne((r: any) => r.url === `${API}/admins/invoices/inv1/pdf`);
      req.flush(new Blob(['contenido']));
      await promise;

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
