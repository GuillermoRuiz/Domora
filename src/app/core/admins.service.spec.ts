import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { AdminsService } from './admins.service';

const rawAdmin = {
  id: 'a1', name: 'Gestora Demo', cif: 'B12345678', plan: 'BASE', tier: '<10',
  status: 'Periodo_de_gracia', mrr: '199.90', discountPct: '10', endDate: '2026-12-31T00:00:00.000Z',
  usersMax: 10,
};

describe('AdminsService', () => {
  let h: ApiServiceHarness<AdminsService>;

  beforeEach(() => {
    h = setupApiService(AdminsService);
  });

  afterEach(() => h.http.verify());

  describe('mapAdministrator', () => {
    it('listAdministrators traduce status, castea mrr/discountPct a número, y por defecto fincas/invoices/activity vacíos', async () => {
      const promise = h.service.listAdministrators();
      const req = h.http.expectOne(`${API}/admins`);
      expect(req.request.method).toBe('GET');
      req.flush([rawAdmin]);
      const [admin] = await promise;
      expect(admin.status).toBe('Periodo de gracia');
      expect(admin.mrr).toBe(199.9);
      expect(admin.discountPct).toBe(10);
      expect(admin.endDate).toBe('2026-12-31');
      expect(admin.fincas).toEqual([]);
      expect(admin.invoices).toEqual([]);
      expect(admin.activity).toEqual([]);
    });

    it('discountPct ausente cae a 0', async () => {
      const promise = h.service.listAdministrators();
      const req = h.http.expectOne(`${API}/admins`);
      req.flush([{ ...rawAdmin, discountPct: undefined }]);
      const [admin] = await promise;
      expect(admin.discountPct).toBe(0);
    });

    it('mapea billing.paymentMethod (Domiciliacion → Domiciliación) cuando viene presente', async () => {
      const promise = h.service.listAdministrators();
      const req = h.http.expectOne(`${API}/admins`);
      req.flush([{ ...rawAdmin, billing: { businessName: 'x', cif: 'x', address: 'x', email: 'x', paymentMethod: 'Domiciliacion', iban: 'x' } }]);
      const [admin] = await promise;
      expect(admin.billing?.paymentMethod).toBe('Domiciliación');
    });

    it('mapea invoices y activity anidados con sus propias fechas normalizadas', async () => {
      const promise = h.service.listAdministrators();
      const req = h.http.expectOne(`${API}/admins`);
      req.flush([{
        ...rawAdmin,
        invoices: [{ id: 'i1', no: 'F-1', date: '2026-01-15T00:00:00.000Z', operationDate: '2026-01-15T00:00:00.000Z', total: '100', status: 'Pagada' }],
        activity: [{ type: 'login', title: 'Inicio de sesión', date: '2026-02-01T10:00:00.000Z' }],
      }]);
      const [admin] = await promise;
      expect(admin.invoices[0].date).toBe('2026-01-15');
      expect(admin.invoices[0].total).toBe(100);
      expect(admin.activity[0].date).toBe('2026-02-01');
    });

    it('maps client status, payment status and the pending invoices summary (amounts as numbers)', async () => {
      const promise = h.service.listAdministrators();
      h.http.expectOne(`${API}/admins`).flush([{
        ...rawAdmin,
        clientStatus: 'En onboarding',
        paymentStatus: 'Pendiente',
        pendingInvoices: { count: '2', amount: '121.50', overdueCount: 1, overdueAmount: '60.75' },
      }]);
      const [admin] = await promise;
      expect(admin.clientStatus).toBe('En onboarding');
      expect(admin.paymentStatus).toBe('Pendiente');
      expect(admin.pendingInvoices).toEqual({ count: 2, amount: 121.5, overdueCount: 1, overdueAmount: 60.75 });
    });

    it('leaves the status fields undefined when the API does not send them', async () => {
      const promise = h.service.listAdministrators();
      h.http.expectOne(`${API}/admins`).flush([rawAdmin]);
      const [admin] = await promise;
      expect(admin.clientStatus).toBeUndefined();
      expect(admin.paymentStatus).toBeUndefined();
      expect(admin.pendingInvoices).toBeUndefined();
    });

    it('findAdministratorById devuelve null si falla', async () => {
      const promise = h.service.findAdministratorById('no-existe');
      const req = h.http.expectOne(`${API}/admins/no-existe`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });

    it('createAdministrator manda el payload tal cual y mapea la respuesta', async () => {
      const promise = h.service.createAdministrator({ name: 'Nueva', cif: 'B1', plan: 'BASE' });
      const req = h.http.expectOne(`${API}/admins`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ name: 'Nueva', cif: 'B1', plan: 'BASE' });
      req.flush({ ...rawAdmin, id: 'a2', name: 'Nueva' });
      expect((await promise).name).toBe('Nueva');
    });
  });

  describe('updateAdministrator', () => {
    it('traduce status a la API solo si viene en el patch', async () => {
      const promise = h.service.updateAdministrator('a1', { status: 'Bloqueada', blockReason: 'Impago' });
      const req = h.http.expectOne(`${API}/admins/a1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'Bloqueada', blockReason: 'Impago' });
      req.flush({ ...rawAdmin, status: 'Bloqueada' });
      expect((await promise).status).toBe('Bloqueada');
    });

    it('sin status en el patch, no añade el campo', async () => {
      const promise = h.service.updateAdministrator('a1', { notes: 'nota' });
      const req = h.http.expectOne(`${API}/admins/a1`);
      expect(req.request.body).toEqual({ notes: 'nota' });
      req.flush(rawAdmin);
      await promise;
    });
  });

  describe('Stripe subscription and «Pasar a facturación manual» (T14)', () => {
    it('maps the linked Stripe subscription of the ficha, with its date normalised', async () => {
      const promise = h.service.findAdministratorById('a1');
      h.http.expectOne(`${API}/admins/a1`).flush({
        ...rawAdmin,
        stripeSubscription: { status: 'canceled', currentPeriodEnd: '2026-09-30T10:00:00.000Z', cancelAtPeriodEnd: false, manualBillingAvailable: true },
      });
      expect((await promise)?.stripeSubscription).toEqual({ status: 'canceled', currentPeriodEnd: '2026-09-30', cancelAtPeriodEnd: false, manualBillingAvailable: true });
    });

    it('a manually billed despacho has no Stripe subscription', async () => {
      const promise = h.service.findAdministratorById('a1');
      h.http.expectOne(`${API}/admins/a1`).flush(rawAdmin);
      expect((await promise)?.stripeSubscription).toBeNull();
    });

    it('switchToManualBilling posts the options and maps the despacho it returns', async () => {
      const promise = h.service.switchToManualBilling('a1', { activate: true, billingInterval: 'year' });
      const req = h.http.expectOne(`${API}/admins/a1/manual-billing`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ activate: true, billingInterval: 'year' });
      req.flush({ ...rawAdmin, status: 'Activa' });
      const admin = await promise;
      expect(admin.status).toBe('Activa');
      expect(admin.stripeSubscription).toBeNull();
    });
  });

  describe('upsertAdminBilling', () => {
    it('traduce paymentMethod hacia y desde la API', async () => {
      const promise = h.service.upsertAdminBilling('a1', {
        businessName: 'x', cif: 'x', address: 'x', email: 'x', paymentMethod: 'Domiciliación', iban: 'ES1234',
      });
      const req = h.http.expectOne(`${API}/admins/a1/billing`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.paymentMethod).toBe('Domiciliacion');
      req.flush({ businessName: 'x', cif: 'x', address: 'x', email: 'x', paymentMethod: 'Domiciliacion', iban: 'ES1234' });
      expect((await promise).paymentMethod).toBe('Domiciliación');
    });
  });

  describe('facturas de administradora', () => {
    it('issueAdminInvoice — POST sin cuerpo, mapea la factura creada', async () => {
      const promise = h.service.issueAdminInvoice('a1');
      const req = h.http.expectOne(`${API}/admins/a1/invoices`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ id: 'i1', no: 'F-1', date: '2026-01-01', operationDate: '2026-01-01', taxBase: '100', taxRate: '21', taxAmount: '21', total: '121', recipientName: 'x', recipientTaxId: 'x', recipientAddress: 'x', status: 'Pendiente' });
      const inv = await promise;
      expect(inv.total).toBe(121);
      expect(inv.taxRate).toBe(21);
    });

    it('listAdminInvoices mapea la lista', async () => {
      const promise = h.service.listAdminInvoices('a1');
      const req = h.http.expectOne(`${API}/admins/a1/invoices`);
      expect(req.request.method).toBe('GET');
      req.flush([{ id: 'i1', no: 'F-1', date: '2026-01-01', total: '50' }]);
      expect((await promise)[0].total).toBe(50);
    });

    it('downloadAdminInvoicePdf pide un blob', async () => {
      const promise = h.service.downloadAdminInvoicePdf('i1');
      const req = h.http.expectOne(`${API}/admins/invoices/i1/pdf`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['%PDF-fake']));
      expect(await promise).toBeInstanceOf(Blob);
    });
  });

  describe('invitaciones', () => {
    it('createAdminInvite manda el administratorId', async () => {
      const promise = h.service.createAdminInvite('a1');
      const req = h.http.expectOne(`${API}/auth/admin-invites`);
      expect(req.request.body).toEqual({ administratorId: 'a1' });
      req.flush({ token: 'tok123' });
      expect((await promise).token).toBe('tok123');
    });

    it('createTeamInvite no manda administratorId — el backend lo saca del JWT de sesión', async () => {
      const promise = h.service.createTeamInvite();
      const req = h.http.expectOne(`${API}/auth/team-invites`);
      expect(req.request.body).toEqual({});
      req.flush({ token: 'tok456' });
      expect((await promise).token).toBe('tok456');
    });
  });

  describe('getMySubscription', () => {
    it('normaliza status, castea numéricos, y expone blockReason', async () => {
      const promise = h.service.getMySubscription();
      const req = h.http.expectOne(`${API}/subscriptions/me`);
      req.flush({ plan: 'BASE', tier: '<10', status: 'Bloqueada', blockReason: 'Impago de 3 mensualidades', mrr: '99', discountPct: undefined, endDate: '2026-06-01T00:00:00.000Z', usersMax: 10, usersActive: 4 });
      const sub = await promise;
      expect(sub.status).toBe('Bloqueada');
      expect(sub.blockReason).toBe('Impago de 3 mensualidades');
      expect(sub.mrr).toBe(99);
      expect(sub.discountPct).toBe(0);
      expect(sub.endDate).toBe('2026-06-01');
    });

    it('blockReason ausente cae a null, no a undefined', async () => {
      const promise = h.service.getMySubscription();
      const req = h.http.expectOne(`${API}/subscriptions/me`);
      req.flush({ plan: 'BASE', tier: '<10', status: 'Activa', mrr: '0', endDate: null, usersMax: 5, usersActive: 1 });
      expect((await promise).blockReason).toBeNull();
    });
  });

  describe('countActiveUsersForAdministrator', () => {
    it('delega en findAdministratorById y lee usersActive', async () => {
      const promise = h.service.countActiveUsersForAdministrator('a1');
      const req = h.http.expectOne(`${API}/admins/a1`);
      req.flush({ ...rawAdmin, usersActive: 7 });
      expect(await promise).toBe(7);
    });

    it('sin administradora encontrada, devuelve 0', async () => {
      const promise = h.service.countActiveUsersForAdministrator('no-existe');
      const req = h.http.expectOne(`${API}/admins/no-existe`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBe(0);
    });
  });

  describe('Plans catalog', () => {
    it('getPlansCatalog — GET simple', async () => {
      const promise = h.service.getPlansCatalog();
      h.http.expectOne(`${API}/plans`).flush({ prices: { BASE: 29, STANDARD: 59, PREMIUM: 99 }, tiers: { BASE: [], STANDARD: [], PREMIUM: [] } });
      expect((await promise).prices.BASE).toBe(29);
    });
  });
});
