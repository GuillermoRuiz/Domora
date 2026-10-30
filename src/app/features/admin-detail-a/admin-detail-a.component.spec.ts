import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { DespachoContextService } from '../../core/despacho-context.service';
import type { Administrator, OfficeHealth, PlansCatalog } from '../../core/models';
import type { OfficeCompletenessDetail } from '../../core/office-setup.service';
import type { AdministratorDetail } from '../../core/admins.service';
import { AdminDetailAComponent } from './admin-detail-a.component';

function makeAdmin(overrides: Partial<Administrator> = {}): Administrator {
  return {
    id: 'ad1', name: 'Fincas García', cif: 'B12345678', plan: 'STANDARD', tier: 'standard',
    endDate: '2026-12-31', usersActive: 3, usersMax: 100, status: 'Activa', primaryUserId: 'u1',
    phone: '600000000', contactName: 'Pedro García', contactEmail: 'pedro@garcia.com',
    mrr: 59, discountPct: 0, billingInterval: 'month', notes: '', billing: null, fincas: [], invoices: [], activity: [],
    clientStatus: 'Activo', paymentStatus: 'Al día',
    pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 },
    ...overrides,
  };
}

function makeHealth(overrides: Partial<OfficeHealth> = {}): OfficeHealth {
  return {
    administratorId: 'ad1', name: 'Fincas García', plan: 'STANDARD', createdAt: '2026-01-01',
    clientStatus: 'Activo', paymentStatus: 'Al día', completeness: 80, salud: 92, atRisk: false, motivo: null,
    signals: [
      { key: 'payment', score: 100, weight: 40, deduction: 0, available: true },
      { key: 'usage', score: null, weight: 35, deduction: 0, available: false },
      { key: 'completeness', score: 80, weight: 15, deduction: 3, available: true },
      { key: 'support', score: null, weight: 10, deduction: 0, available: false },
    ],
    usage: { activeDays: 10, activeUsers: 2, staffUsers: 2, observedDays: 30 },
    attention: [],
    ...overrides,
  };
}

function makeCompleteness(overrides: Partial<OfficeCompletenessDetail> = {}): OfficeCompletenessDetail {
  return {
    administratorId: 'ad1', name: 'Fincas García', office: 100, estates: 100, total: 100, estateCount: 1,
    onboardingComplete: true, includedInAverage: true,
    officeSteps: [
      { key: 'contact', weight: 'recommended', status: 'done' },
      { key: 'billing', weight: 'required', status: 'done' },
      { key: 'team', weight: 'info', status: 'pending' },
    ],
    estateDetails: [{ estateId: 'e1', name: 'Comunidad Sol', percent: 100, complete: true, steps: [{ key: 'fiscal', weight: 'required', status: 'done' }] }],
    ...overrides,
  };
}

const CATALOG: PlansCatalog = {
  prices: { BASE: 29, STANDARD: 59, PREMIUM: 99 },
  tiers: { BASE: [], STANDARD: [{ max: 100, price: 59 }, { max: 200, price: 89 }], PREMIUM: [] },
};

interface Load {
  admin?: Administrator | AdministratorDetail | 'missing';
  health?: OfficeHealth | 'error';
  completeness?: OfficeCompletenessDetail | 'error';
  query?: Record<string, string>;
}

async function mount(load: Load = {}): Promise<ComponentHarness<AdminDetailAComponent>> {
  sessionStorage.clear();
  const h = setupComponent(AdminDetailAComponent, {
    user: makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null }),
    providers: [{
      provide: ActivatedRoute,
      useValue: { snapshot: { paramMap: convertToParamMap({ id: 'ad1' }), queryParamMap: convertToParamMap(load.query ?? {}) } },
    }],
  });
  h.fixture.detectChanges();
  const adminReq = h.http.expectOne(`${API}/admins/ad1`);
  if (load.admin === 'missing') adminReq.flush({ message: 'no' }, { status: 404, statusText: 'Not Found' });
  else adminReq.flush(load.admin ?? makeAdmin());
  h.http.expectOne(`${API}/plans`).flush(CATALOG);
  const healthReq = h.http.expectOne(`${API}/client-health/offices/ad1`);
  if (load.health === 'error') healthReq.flush({ message: 'boom' }, { status: 500, statusText: 'Error' });
  else healthReq.flush(load.health ?? makeHealth());
  const complReq = h.http.expectOne(`${API}/completeness/offices/ad1`);
  if (load.completeness === 'error') complReq.flush({ message: 'boom' }, { status: 500, statusText: 'Error' });
  else complReq.flush(load.completeness ?? makeCompleteness());
  await settle();
  h.fixture.detectChanges();
  return h;
}

function openSession() {
  return {
    id: 's1', administratorId: 'ad1', staffUserId: 'a1', reason: 'Soporte', ticketRef: null,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), endedAt: null,
  };
}

function openTab(h: ComponentHarness<AdminDetailAComponent>, label: string): void {
  (Array.from(h.el.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === label) as HTMLElement).click();
  h.fixture.detectChanges();
}

function button(el: HTMLElement, text: string, scope = ''): HTMLElement {
  return Array.from(el.querySelectorAll(`${scope} button`)).find((b) => b.textContent?.trim() === text) as HTMLElement;
}

describe('AdminDetailAComponent (ficha 360°)', () => {
  afterEach(() => sessionStorage.clear());

  describe('cabecera', () => {
    it('shows the despacho name, plan, client status, payment status and salud', async () => {
      const h = await mount({
        admin: makeAdmin({ clientStatus: 'En onboarding', paymentStatus: 'Pendiente', pendingInvoices: { count: 1, amount: 71.39, overdueCount: 0, overdueAmount: 0 } }),
        health: makeHealth({ salud: 88.4 }),
      });
      const header = h.el.querySelector('.detail-header') as HTMLElement;

      expect(header.querySelector('h1')?.textContent).toContain('Fincas García');
      expect(header.querySelector('[data-field="plan"]')?.textContent).toContain('STANDARD');
      expect(header.querySelector('[data-field="estado"]')?.textContent).toContain('En onboarding');
      expect(header.querySelector('[data-field="pago"]')?.textContent).toContain('Pendiente');
      expect(header.querySelector('[data-field="pago"]')?.textContent).toContain('71,39 €');
      expect(header.querySelector('[data-field="salud"]')?.textContent).toContain('88');
      expect(header.querySelector('.risk-tag')).toBeNull();
    });

    it('header labels use the muted text token (4.64:1 light, 6.19:1 dark), not the decorative --color-light', async () => {
      const h = await mount();
      const label = h.el.querySelector('.detail-header .fact__label') as HTMLElement;
      expect(getComputedStyle(label).color.replace(/\s+/g, '')).toBe('var(--color-muted)');
    });

    it('shows «En riesgo» with its motive when salud is below the threshold', async () => {
      const h = await mount({ health: makeHealth({ salud: 55.6, atRisk: true, motivo: { code: 'payment', label: 'Pagos pendientes' } }) });

      const tag = h.el.querySelector('.detail-header .risk-tag') as HTMLElement;
      expect(tag.textContent).toContain('En riesgo');
      expect(tag.getAttribute('aria-label')).toBe('En riesgo: Pagos pendientes');
    });

    it('«Ver sus comunidades» selects the despacho and, inside its support session, opens its community list', async () => {
      const h = await mount();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      button(h.el, 'Ver sus comunidades', '.detail-header').click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/support-sessions/active`).flush([openSession()]);
      await settle();

      expect(TestBed.inject(DespachoContextService).selected()).toEqual({ id: 'ad1', name: 'Fincas García' });
      expect(navigate).toHaveBeenCalledWith('/b/estates');
    });

    it('«Ver sus comunidades» without a support session asks for one first and enters once it starts', async () => {
      const h = await mount();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      button(h.el, 'Ver sus comunidades', '.detail-header').click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/support-sessions/active`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      const dialog = h.el.querySelector('app-support-session-dialog') as HTMLElement;
      expect(dialog).not.toBeNull();

      const reason = dialog.querySelector('textarea, input') as HTMLTextAreaElement;
      reason.value = 'Revisar la configuración de la comunidad';
      reason.dispatchEvent(new Event('input'));
      (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      h.http.expectOne(`${API}/support-sessions`).flush(openSession());
      await settle();
      h.fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith('/b/estates');
      expect(h.el.querySelector('app-support-session-dialog')).toBeNull();
    });

    it('sent back by the route guard (`?support=required`) it asks for the support session', async () => {
      const h = await mount({ query: { support: 'required' } });
      h.http.expectOne(`${API}/support-sessions/active`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(TestBed.inject(DespachoContextService).selected()).toEqual({ id: 'ad1', name: 'Fincas García' });
      expect(h.el.querySelector('app-support-session-dialog')).not.toBeNull();
    });

    it('an unknown despacho shows a not-found message with a way back', async () => {
      const h = await mount({ admin: 'missing' });

      expect(h.el.querySelector('.detail-error')?.textContent).toContain('No se ha encontrado este administrador');
      expect(h.el.querySelector('a[href="/a/admins"]')).not.toBeNull();
      expect(h.el.querySelector('[role="tab"]')).toBeNull();
    });
  });

  describe('Resumen', () => {
    it('shows contact, contract and KPIs', async () => {
      const h = await mount({ admin: makeAdmin({ billingInterval: 'year', pendingInvoices: { count: 2, amount: 100, overdueCount: 1, overdueAmount: 50 } }) });
      const panel = h.el.querySelector('[role="tabpanel"]') as HTMLElement;

      expect(panel.textContent).toContain('Pedro García');
      expect(panel.textContent).toContain('pedro@garcia.com');
      expect(panel.textContent).toContain('Anual');
      expect(panel.querySelector('[data-kpi="pendientes"]')?.textContent).toContain('2');
    });

    it('when nobody can sign in yet, «Generar enlace de invitación» shows a one-time link', async () => {
      const h = await mount({ admin: makeAdmin({ primaryUserId: undefined }) });

      button(h.el, 'Generar enlace de invitación').click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/auth/admin-invites`).flush({ token: 'tok9' });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.invite-link-box__value')?.textContent).toContain('/invite/tok9');
    });

    it('«Qué falta configurar» lists the pending despacho steps and each estate with its pending steps', async () => {
      const h = await mount({
        completeness: makeCompleteness({
          office: 50, estates: 40, total: 45, onboardingComplete: false,
          officeSteps: [
            { key: 'contact', weight: 'recommended', status: 'done' },
            { key: 'billing', weight: 'required', status: 'pending' },
            { key: 'twoFactor', weight: 'recommended', status: 'pending' },
            { key: 'team', weight: 'info', status: 'pending' },
          ],
          estateDetails: [
            { estateId: 'e1', name: 'Comunidad Sol', percent: 40, complete: false, steps: [
              { key: 'fiscal', weight: 'required', status: 'done' },
              { key: 'sepa', weight: 'recommended', status: 'pending' },
              { key: 'linked', weight: 'info', status: 'pending' },
            ] },
          ],
        }),
      });
      const missing = h.el.querySelector('[data-section="pendiente"]') as HTMLElement;

      expect(h.el.querySelector('[data-section="completitud"]')?.textContent).toContain('45 %');
      expect(missing.textContent).toContain('Datos de facturación');
      expect(missing.textContent).toContain('Obligatorio');
      expect(missing.textContent).toContain('Verificación en dos pasos');
      expect(missing.textContent).not.toContain('Datos de contacto');
      expect(missing.textContent).not.toContain('Equipo invitado');
      expect(missing.textContent).toContain('Comunidad Sol');
      expect(missing.textContent).toContain('Acreedor SEPA');
      expect(missing.textContent).not.toContain('Propietarios en la app');
    });

    it('with everything configured, says so', async () => {
      const h = await mount();

      expect(h.el.querySelector('[data-section="pendiente"]')?.textContent).toContain('Todo lo que cuenta para la completitud está configurado');
    });

    it('breaks salud down by signal, marking the ones without data', async () => {
      const h = await mount();
      const rows = Array.from(h.el.querySelectorAll('[data-section="salud"] tbody tr')).map((r) => r.textContent ?? '');

      expect(rows).toHaveLength(4);
      expect(rows[0]).toContain('Pagos');
      expect(rows[0]).toContain('100');
      expect(rows[1]).toContain('Uso de la plataforma');
      expect(rows[1]).toContain('Sin datos todavía');
      expect(rows[2]).toContain('−3');
    });

    it('lists the «Requieren atención» reasons when there are any', async () => {
      const h = await mount({ health: makeHealth({ attention: [{ code: 'overdue_payment', label: 'Pagos vencidos', severity: 3 }] }) });

      expect(h.el.querySelector('[data-section="atencion"]')?.textContent).toContain('Pagos vencidos');
    });

    it('if salud and completitud fail to load, the ficha still shows the despacho with an error in those blocks', async () => {
      const h = await mount({ health: 'error', completeness: 'error' });

      expect(h.el.querySelector('.detail-header h1')?.textContent).toContain('Fincas García');
      expect(h.el.querySelector('[data-section="completitud"]')?.textContent).toContain('No se ha podido cargar la completitud');
      expect(h.el.querySelector('[data-section="salud"]')?.textContent).toContain('No se ha podido cargar la salud');
    });
  });

  describe('Suscripción', () => {
    async function openBlockModal(admin: Administrator) {
      const h = await mount({ admin });
      openTab(h, 'Suscripción');
      button(h.el, admin.status === 'Bloqueada' ? 'Desbloquear cuenta' : 'Bloquear cuenta').click();
      h.fixture.detectChanges();
      return h;
    }

    it('el botón de confirmar bloqueo está deshabilitado hasta marcar la casilla de confirmación', async () => {
      const h = await openBlockModal(makeAdmin({ status: 'Activa' }));

      const confirm = button(h.el, 'Bloquear', '.modal__footer') as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      (h.el.querySelector('.checkbox-row input[type="checkbox"]') as HTMLInputElement).click();
      h.fixture.detectChanges();
      expect(confirm.disabled).toBe(false);
    });

    it('al bloquear, manda el motivo y status=Bloqueada y la ficha refleja el nuevo estado', async () => {
      const h = await openBlockModal(makeAdmin({ status: 'Activa' }));
      const textarea = h.el.querySelector('.modal .form-textarea') as HTMLTextAreaElement;
      textarea.value = 'Impago reiterado';
      textarea.dispatchEvent(new Event('input'));
      (h.el.querySelector('.checkbox-row input[type="checkbox"]') as HTMLInputElement).click();
      h.fixture.detectChanges();

      button(h.el, 'Bloquear', '.modal__footer').click();
      const patch = h.http.expectOne((r) => r.url === `${API}/admins/ad1` && r.method === 'PATCH');
      expect(patch.request.body).toEqual({ status: 'Bloqueada', blockReason: 'Impago reiterado' });
      patch.flush(makeAdmin({ status: 'Bloqueada' }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/admins/ad1` && r.method === 'GET').flush(makeAdmin({ status: 'Bloqueada', clientStatus: 'Suspendido' }));
      h.http.expectOne(`${API}/client-health/offices/ad1`).flush(makeHealth({ clientStatus: 'Suspendido' }));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.modal-backdrop')).toBeNull();
      expect(h.el.querySelector('.toast')?.textContent).toContain('bloqueada correctamente');
      expect(h.el.querySelector('[data-field="estado"]')?.textContent).toContain('Suspendido');
    });

    it('«Aplicar descuento» sends the discount with its end date', async () => {
      const h = await mount();
      openTab(h, 'Suscripción');
      button(h.el, 'Aplicar descuento').click();
      h.fixture.detectChanges();
      const range = h.el.querySelector('.modal .form-range') as HTMLInputElement;
      range.value = '20';
      range.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();

      button(h.el, 'Aplicar descuento', '.modal__footer').click();
      const patch = h.http.expectOne((r) => r.url === `${API}/admins/ad1` && r.method === 'PATCH');
      expect(patch.request.body.discountPct).toBe(20);
      expect(patch.request.body.discountUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      patch.flush(makeAdmin({ discountPct: 20 }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/admins/ad1` && r.method === 'GET').flush(makeAdmin({ discountPct: 20 }));
      h.http.expectOne(`${API}/client-health/offices/ad1`).flush(makeHealth());
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('Descuento aplicado');
    });
  });

  describe('Suscripción — «Pasar a facturación manual» (T14)', () => {
    const CANCELED = { status: 'canceled' as const, currentPeriodEnd: '2026-09-30', cancelAtPeriodEnd: false, manualBillingAvailable: true };
    const canceledAdmin = (overrides: Partial<Administrator> = {}): AdministratorDetail =>
      ({ ...makeAdmin({ status: 'Vencida', clientStatus: 'Cancelado', ...overrides }), stripeSubscription: CANCELED });

    async function openDialog(admin: AdministratorDetail) {
      const h = await mount({ admin });
      openTab(h, 'Suscripción');
      button(h.el, 'Pasar a facturación manual').click();
      h.fixture.detectChanges();
      return h;
    }

    it('is offered while the Stripe subscription is dead (canceled or expired)', async () => {
      const h = await mount({ admin: canceledAdmin() });
      openTab(h, 'Suscripción');
      expect(h.el.querySelector('[data-block="manual-billing"]')?.textContent).toContain('cancelada');
      expect(button(h.el, 'Pasar a facturación manual')).toBeTruthy();
    });

    it('is not offered while the Stripe subscription is alive', async () => {
      const h = await mount({ admin: { ...makeAdmin(), stripeSubscription: { ...CANCELED, status: 'past_due', manualBillingAvailable: false } } });
      openTab(h, 'Suscripción');
      expect(h.el.querySelector('[data-block="manual-billing"]')).toBeNull();
      expect(button(h.el, 'Pasar a facturación manual')).toBeUndefined();
    });

    it('is not offered to a despacho already billed manually', async () => {
      const h = await mount({ admin: { ...makeAdmin(), stripeSubscription: null } });
      openTab(h, 'Suscripción');
      expect(button(h.el, 'Pasar a facturación manual')).toBeUndefined();
    });

    it('the confirm dialog explains the effect and offers to reactivate a Vencida despacho', async () => {
      const h = await openDialog(canceledAdmin());
      const dialog = h.el.querySelector('[role="dialog"][aria-label="Pasar a facturación manual"]') as HTMLElement;
      expect(dialog.textContent).toContain('Se desvincula la suscripción de Stripe cancelada');
      expect(dialog.textContent).toContain('deja de contar como cancelado');
      expect(dialog.textContent).toContain('MRR');
      expect(dialog.textContent).toContain('El cliente de Stripe y su historial se conservan');
      const reactivate = dialog.querySelector('input[name="manual-billing-activate"]') as HTMLInputElement;
      expect(reactivate.checked).toBe(true);
    });

    it('confirming detaches it, reactivates the account and reloads salud and completitud', async () => {
      const h = await openDialog(canceledAdmin());
      const interval = h.el.querySelector('select[name="manual-billing-interval"]') as HTMLSelectElement;
      interval.value = 'year';
      interval.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();

      button(h.el, 'Pasar a facturación manual', '.modal__footer').click();
      const post = h.http.expectOne((r) => r.url === `${API}/admins/ad1/manual-billing` && r.method === 'POST');
      expect(post.request.body).toEqual({ activate: true, billingInterval: 'year' });
      post.flush({ ...makeAdmin({ status: 'Activa', clientStatus: 'Activo', billingInterval: 'year' }) });
      await settle();
      h.http.expectOne(`${API}/client-health/offices/ad1`).flush(makeHealth());
      h.http.expectOne(`${API}/completeness/offices/ad1`).flush(makeCompleteness());
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.modal-backdrop')).toBeNull();
      expect(h.el.querySelector('.toast')?.textContent).toContain('Despacho pasado a facturación manual');
      expect(h.el.querySelector('[data-field="estado"]')?.textContent).toContain('Activo');
      expect(button(h.el, 'Pasar a facturación manual')).toBeUndefined();
    });

    it('without reactivating and with the same interval, sends no options', async () => {
      const h = await openDialog(canceledAdmin());
      (h.el.querySelector('input[name="manual-billing-activate"]') as HTMLInputElement).click();
      h.fixture.detectChanges();

      button(h.el, 'Pasar a facturación manual', '.modal__footer').click();
      const post = h.http.expectOne(`${API}/admins/ad1/manual-billing`);
      expect(post.request.body).toEqual({});
      post.flush({ ...makeAdmin({ status: 'Vencida', clientStatus: 'Suspendido' }) });
      await settle();
      h.http.expectOne(`${API}/client-health/offices/ad1`).flush(makeHealth());
      h.http.expectOne(`${API}/completeness/offices/ad1`).flush(makeCompleteness());
      await settle();
    });

    it('a Bloqueada despacho is not offered reactivation: it stays blocked', async () => {
      const h = await openDialog(canceledAdmin({ status: 'Bloqueada' }));
      expect(h.el.querySelector('input[name="manual-billing-activate"]')).toBeNull();
      expect(h.el.querySelector('.modal')?.textContent).toContain('seguirá bloqueada');
    });

    it('a refusal keeps the dialog open and shows the server message', async () => {
      const h = await openDialog(canceledAdmin());
      button(h.el, 'Pasar a facturación manual', '.modal__footer').click();
      h.http.expectOne(`${API}/admins/ad1/manual-billing`).flush(
        { message: 'La suscripción de Stripe acaba de cambiar. Recarga la ficha y vuelve a intentarlo.' },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.modal-backdrop')).not.toBeNull();
      expect(h.el.querySelector('.toast')?.textContent).toContain('La suscripción de Stripe acaba de cambiar');
    });
  });

  describe('Fincas', () => {
    it('lists the estates and opens one inside the despacho context', async () => {
      const h = await mount({ admin: makeAdmin({ fincas: [{ id: 'e1', name: 'Comunidad Sol', type: 'Edificio', location: 'Madrid', units: 12, since: '2026-01-01', active: true }] }) });
      openTab(h, 'Fincas');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      expect(h.el.querySelector('[role="tabpanel"]')?.textContent).toContain('Comunidad Sol');
      button(h.el, 'Abrir', '[role="tabpanel"]').click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/support-sessions/active`).flush([openSession()]);
      await settle();

      expect(TestBed.inject(DespachoContextService).selected()).toEqual({ id: 'ad1', name: 'Fincas García' });
      expect(navigate).toHaveBeenCalledWith('/b/estates/e1');
    });

    it('without estates, shows the empty state', async () => {
      const h = await mount();
      openTab(h, 'Fincas');

      expect(h.el.querySelector('[role="tabpanel"]')?.textContent).toContain('todavía no gestiona ninguna finca');
    });
  });

  describe('Facturación', () => {
    it('shows the invoices and the pending and overdue counts', async () => {
      const h = await mount({
        admin: makeAdmin({
          pendingInvoices: { count: 2, amount: 142.78, overdueCount: 1, overdueAmount: 71.39 },
          invoices: [{ id: 'i1', no: 'DOM-2026-0001', date: '2026-09-01', operationDate: '2026-09-01', concept: 'Plan', taxBase: 59, taxRate: 21, taxAmount: 12.39, total: 71.39, recipientName: 'x', recipientTaxId: 'x', recipientAddress: 'x', status: 'Vencida' }],
        }),
      });
      openTab(h, 'Facturación');
      const panel = h.el.querySelector('[role="tabpanel"]') as HTMLElement;

      expect(panel.textContent).toContain('DOM-2026-0001');
      expect(panel.querySelector('[data-kpi="pendientes"]')?.textContent).toContain('2');
      expect(panel.querySelector('[data-kpi="pendientes"]')?.textContent).toContain('142,78 €');
      expect(panel.querySelector('[data-kpi="vencidas"]')?.textContent).toContain('1');
      expect(panel.querySelector('[data-kpi="vencidas"]')?.textContent).toContain('71,39 €');
    });

    it('opens directly on Facturación with ?tab=facturacion (from «Ver facturación»)', async () => {
      const h = await mount({ query: { tab: 'facturacion' } });
      const selected = h.el.querySelector('[role="tab"][aria-selected="true"]');
      expect(selected?.textContent?.trim()).toBe('Facturación');
      expect(h.el.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('tab-facturacion');
    });

    it('an unknown ?tab= falls back to Resumen', async () => {
      const h = await mount({ query: { tab: 'nope' } });
      expect(h.el.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('Resumen');
    });
  });

  describe('Actividad', () => {
    it('shows the activity feed, including the business events', async () => {
      const h = await mount({
        admin: makeAdmin({ activity: [
          { id: 'x1', type: 'payment_received', title: 'Pago recibido', date: '2026-10-01', author: 'Stripe' },
          { id: 'x2', type: 'onboarding_completed', title: 'Puesta en marcha completada', date: '2026-09-01', author: 'Domora' },
        ] }),
      });
      openTab(h, 'Actividad');

      const items = h.el.querySelectorAll('.timeline-item');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('Pago recibido');
      expect(items[1].textContent).toContain('Puesta en marcha completada');
    });

    it('without activity, shows the empty state', async () => {
      const h = await mount();
      openTab(h, 'Actividad');

      expect(h.el.querySelector('[role="tabpanel"]')?.textContent).toContain('Sin actividad registrada');
    });
  });
});
