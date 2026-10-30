import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { LeadsService } from './leads.service';

const RAW_LEAD = {
  id: 'l1',
  name: 'Fincas Norte',
  contactName: 'Marta',
  contactEmail: 'marta@norte.es',
  contactPhone: null,
  city: 'Bilbao',
  origin: 'referido',
  planOfInterest: 'STANDARD',
  status: 'nuevo',
  nextAction: 'Llamar',
  nextActionAt: '2026-11-03',
  notes: null,
  convertedAdministratorId: null,
  convertedAt: null,
  createdAt: '2026-10-20T09:30:00.000Z',
  updatedAt: '2026-10-20T09:30:00.000Z',
  onboardingRequestId: null,
  onboardingRequest: null,
  convertedAdministrator: null,
  followUpCount: 2,
  lastFollowUpAt: '2026-10-22T08:00:00.000Z',
};

describe('LeadsService', () => {
  let h: ApiServiceHarness<LeadsService>;

  beforeEach(() => {
    h = setupApiService(LeadsService);
  });

  afterEach(() => h.http.verify());

  it('listLeads pide las oportunidades y deja las fechas en YYYY-MM-DD', async () => {
    const promise = h.service.listLeads();
    h.http.expectOne(`${API}/leads`).flush([RAW_LEAD]);
    const [lead] = await promise;
    expect(lead).toMatchObject({ id: 'l1', origin: 'referido', planOfInterest: 'STANDARD', createdAt: '2026-10-20', lastFollowUpAt: '2026-10-22', followUpCount: 2 });
  });

  it('getLead trae el seguimiento comercial', async () => {
    const promise = h.service.getLead('l1');
    h.http.expectOne(`${API}/leads/l1`).flush({ ...RAW_LEAD, followUps: [{ id: 'f1', occurredAt: '2026-10-22T08:00:00.000Z', text: 'Llamada', author: 'Ana' }] });
    expect((await promise).followUps).toEqual([{ id: 'f1', occurredAt: '2026-10-22', text: 'Llamada', author: 'Ana' }]);
  });

  it('createLead, updateLead y addLeadFollowUp envían el cuerpo tal cual', async () => {
    const created = h.service.createLead({ name: 'Fincas Norte', origin: 'web' });
    const post = h.http.expectOne(`${API}/leads`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ name: 'Fincas Norte', origin: 'web' });
    post.flush(RAW_LEAD);
    await created;

    const updated = h.service.updateLead('l1', { status: 'contactado', nextActionAt: null });
    const patch = h.http.expectOne(`${API}/leads/l1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ status: 'contactado', nextActionAt: null });
    patch.flush(RAW_LEAD);
    await updated;

    const followUp = h.service.addLeadFollowUp('l1', 'Enviada la propuesta');
    const fu = h.http.expectOne(`${API}/leads/l1/follow-ups`);
    expect(fu.request.body).toEqual({ text: 'Enviada la propuesta' });
    fu.flush({ id: 'f2', occurredAt: '2026-10-26T10:00:00.000Z', text: 'Enviada la propuesta', author: 'Ana' });
    expect((await followUp).occurredAt).toBe('2026-10-26');
  });

  it('convertLead crea el despacho y devuelve su id', async () => {
    const promise = h.service.convertLead('l1', { cif: 'B12345678' });
    const req = h.http.expectOne(`${API}/leads/l1/convert`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ cif: 'B12345678' });
    req.flush({ administratorId: 'ad9', lead: { ...RAW_LEAD, status: 'convertido' } });
    expect(await promise).toEqual({ administratorId: 'ad9' });
  });

  it('clientsOverview convierte importes a número y fechas a YYYY-MM-DD', async () => {
    const promise = h.service.clientsOverview();
    h.http.expectOne(`${API}/clients/overview`).flush({
      kpis: { activeClients: 3, inTrial: 1, renewals: { count: 2, amount: '714.5', windowDays: 90 }, churnRisk: 1 },
      clients: [{ administratorId: 'ad1', signupAt: '2026-01-15T09:00:00.000Z', nextRenewal: { date: '2026-11-25', amount: '588' }, lastActiveDay: '2026-10-24', nextAction: null, nextActionAt: null }],
    });
    const overview = await promise;
    expect(overview.kpis.renewals.amount).toBe(714.5);
    expect(overview.clients[0]).toEqual({ administratorId: 'ad1', signupAt: '2026-01-15', nextRenewal: { date: '2026-11-25', amount: 588 }, lastActiveDay: '2026-10-24', nextAction: null, nextActionAt: null });
  });

  it('próxima acción y seguimiento de un despacho cliente', async () => {
    const set = h.service.setClientNextAction('ad1', { nextAction: 'Renovación', nextActionAt: '2026-12-01' });
    const put = h.http.expectOne(`${API}/clients/ad1/next-action`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ nextAction: 'Renovación', nextActionAt: '2026-12-01' });
    put.flush({ administratorId: 'ad1', nextAction: 'Renovación', nextActionAt: '2026-12-01' });
    await set;

    const list = h.service.clientFollowUps('ad1');
    h.http.expectOne(`${API}/clients/ad1/follow-ups`).flush([{ id: 'f1', occurredAt: '2026-10-20T10:00:00Z', text: 'Hola', author: 'Ana' }]);
    expect((await list)[0].occurredAt).toBe('2026-10-20');

    const add = h.service.addClientFollowUp('ad1', 'Llamada');
    const post = h.http.expectOne(`${API}/clients/ad1/follow-ups`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ text: 'Llamada' });
    post.flush({ id: 'f2', occurredAt: '2026-10-26T10:00:00Z', text: 'Llamada', author: 'Ana' });
    await add;
  });
});
