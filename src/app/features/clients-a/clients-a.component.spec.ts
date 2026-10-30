import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { ClientsAComponent } from './clients-a.component';

const RAW_ADMINS = [
  {
    id: 'a', name: 'Fincas Alba', cif: 'B11111111', plan: 'PREMIUM', tier: 'premium', endDate: null, usersActive: 3, usersMax: 200,
    status: 'Activa', phone: '600111111', contactName: 'Ana Alba', contactEmail: 'ana@alba.es', mrr: '99', discountPct: '0',
    billingInterval: 'year', notes: '', billing: null, clientStatus: 'Activo', paymentStatus: 'Al día',
    pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 },
  },
  {
    id: 'b', name: 'Gestión Bravo', cif: 'B22222222', plan: 'BASE', tier: 'base', endDate: null, usersActive: 1, usersMax: 25,
    status: 'Activa', phone: '600222222', contactName: 'Lucía Pérez', contactEmail: 'lucia@bravo.es', mrr: '29', discountPct: '0',
    billingInterval: 'month', notes: '', billing: null, clientStatus: 'En prueba', paymentStatus: 'Al día',
    pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 },
  },
];

function office(administratorId: string, salud: number, atRisk: boolean, motivo: string | null) {
  return {
    administratorId, name: '', plan: 'BASE', createdAt: '2026-01-01T00:00:00Z', clientStatus: 'Activo', paymentStatus: 'Al día',
    completeness: 70, salud, atRisk, motivo: motivo ? { code: 'low_usage', label: motivo } : null, signals: [],
    usage: { activeDays: 0, activeUsers: 0, staffUsers: 0, observedDays: 0 }, attention: [],
  };
}

const RAW_HEALTH = { atRiskBelow: 70, churnRisk: 1, offices: [office('a', 91, false, null), office('b', 42, true, 'Uso muy bajo')] };

const RAW_OVERVIEW = {
  kpis: { activeClients: 1, inTrial: 1, renewals: { count: 1, amount: '1188', windowDays: 90 }, churnRisk: 1 },
  clients: [
    { administratorId: 'a', signupAt: '2026-10-01T09:00:00Z', nextRenewal: { date: '2026-12-01', amount: '1188' }, lastActiveDay: '2026-10-24', nextAction: 'Preparar renovación', nextActionAt: '2026-11-15' },
    { administratorId: 'b', signupAt: '2025-01-10T09:00:00Z', nextRenewal: null, lastActiveDay: null, nextAction: null, nextActionAt: null },
  ],
};

function rawLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1', name: 'Fincas Norte', contactName: 'Marta Ruiz', contactEmail: 'marta@norte.es', contactPhone: '600333333', city: 'Bilbao',
    origin: 'referido', planOfInterest: 'STANDARD', status: 'nuevo', nextAction: 'Llamar', nextActionAt: '2026-11-03', notes: null,
    convertedAdministratorId: null, convertedAt: null, createdAt: '2026-10-20T09:00:00Z', onboardingRequest: null,
    convertedAdministrator: null, followUpCount: 0, lastFollowUpAt: null,
    ...overrides,
  };
}

const RAW_LEADS = [
  rawLead(),
  rawLead({ id: 'l2', name: 'Administración de Residencial Luna', origin: 'solicitud_alta', planOfInterest: null, contactName: null,
    onboardingRequest: { id: 'r1', communityName: 'Residencial Luna', communityAddress: null, requestedByName: 'Pedro', status: 'pending' } }),
  rawLead({ id: 'l3', name: 'Descartada SL', status: 'descartado' }),
];

interface Load {
  overview?: 'error';
  health?: 'error';
}

async function mount(load: Load = {}): Promise<ComponentHarness<ClientsAComponent>> {
  try { localStorage.clear(); } catch { /* ignore */ }
  const h = setupComponent(ClientsAComponent, { user: makeUser({ id: 'u1', role: 'A', estateIds: [], administratorId: null }) });
  h.fixture.detectChanges();
  h.http.expectOne(`${API}/admins`).flush(RAW_ADMINS);
  const healthReq = h.http.expectOne(`${API}/client-health/offices`);
  if (load.health === 'error') healthReq.flush({ message: 'boom' }, { status: 500, statusText: 'Error' });
  else healthReq.flush(RAW_HEALTH);
  const overviewReq = h.http.expectOne(`${API}/clients/overview`);
  if (load.overview === 'error') overviewReq.flush({ message: 'boom' }, { status: 500, statusText: 'Error' });
  else overviewReq.flush(RAW_OVERVIEW);
  h.http.expectOne(`${API}/leads`).flush(RAW_LEADS);
  await settle();
  h.fixture.detectChanges();
  return h;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (h: ComponentHarness<ClientsAComponent>) => Array.from(h.el.querySelectorAll<HTMLTableRowElement>('[data-table="clients"] tbody tr[data-id]'));
const kpi = (h: ComponentHarness<ClientsAComponent>, label: string) =>
  Array.from(h.el.querySelectorAll('app-stat-card')).find(c => text(c.querySelector('.stat-card__label')).startsWith(label));

/** Clicks an `app-btn` (its inner button) or a plain element. */
function press(el: Element | null): void {
  const target = (el?.querySelector('button') ?? el) as HTMLElement | null;
  if (!target) throw new Error('element not found');
  target.click();
}

async function refresh(h: ComponentHarness<ClientsAComponent>) {
  await settle();
  h.fixture.detectChanges();
}

describe('ClientsAComponent (Clientes, S13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('muestra los KPIs con su explicación: clientes activos, en prueba, renovaciones próximas con € y churn risk', async () => {
    const h = await mount();
    expect(text(kpi(h, 'Clientes activos')?.querySelector('.stat-card__value'))).toBe('1');
    expect(text(kpi(h, 'En prueba')?.querySelector('.stat-card__value'))).toBe('1');
    const renewals = kpi(h, 'Renovaciones próximas (90 días)');
    expect(text(renewals?.querySelector('.stat-card__value'))).toBe('1');
    expect(text(renewals?.querySelector('.stat-card__sub'))).toContain('1188,00 €');
    expect(text(kpi(h, 'Churn risk')?.querySelector('.stat-card__value'))).toBe('1');
    for (const label of ['Clientes activos', 'En prueba', 'Renovaciones próximas (90 días)', 'Churn risk']) {
      expect(kpi(h, label)?.querySelector('app-info-tip')).not.toBeNull();
    }
  });

  it('la tabla muestra cliente, contacto, plan, MRR, estado con «En riesgo», salud y próxima acción', async () => {
    const h = await mount();
    const [alba, bravo] = rows(h);
    expect(text(alba.querySelector('[data-col="cliente"]'))).toContain('Fincas Alba');
    expect(text(alba.querySelector('[data-col="contacto"]'))).toContain('Ana Alba');
    expect(text(alba.querySelector('[data-col="contacto"]'))).toContain('ana@alba.es');
    expect(text(alba.querySelector('[data-col="plan"]'))).toBe('PREMIUM');
    expect(text(alba.querySelector('[data-col="mrr"]'))).toBe('99,00 €');
    expect(text(alba.querySelector('[data-col="estado"]'))).toBe('Activo');
    expect(text(alba.querySelector('[data-col="salud"]'))).toBe('91');
    expect(text(alba.querySelector('[data-col="accion"]'))).toContain('Preparar renovación');
    expect(text(alba.querySelector('[data-col="accion"]'))).toContain('15 nov 2026');
    expect(text(bravo.querySelector('[data-col="estado"]'))).toContain('En prueba');
    expect(bravo.querySelector('[data-col="estado"] app-risk-tag')).not.toBeNull();
    expect(text(bravo.querySelector('[data-col="accion"]'))).toContain('Sin próxima acción');
  });

  it('las columnas opcionales (fecha de alta, próxima renovación, última actividad) se activan a petición', async () => {
    const h = await mount();
    expect(h.el.querySelector('[data-col="alta"]')).toBeNull();
    for (const key of ['signupAt', 'nextRenewal', 'lastActivity']) {
      (h.el.querySelector(`[data-optional="${key}"] input`) as HTMLInputElement).click();
    }
    h.fixture.detectChanges();
    const [alba, bravo] = rows(h);
    expect(text(alba.querySelector('[data-col="alta"]'))).toBe('1 oct 2026');
    expect(text(alba.querySelector('[data-col="renovacion"]'))).toContain('1 dic 2026');
    expect(text(alba.querySelector('[data-col="renovacion"]'))).toContain('1188,00 €');
    expect(text(alba.querySelector('[data-col="actividad"]'))).toBe('24 oct 2026');
    expect(text(bravo.querySelector('[data-col="renovacion"]'))).toBe('—');
  });

  it('busca y filtra por estado comercial, plan y fecha de alta', async () => {
    const h = await mount();
    const search = h.el.querySelector('[data-search]') as HTMLInputElement;
    search.value = 'lucía';
    search.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['b']);
    search.value = '';
    search.dispatchEvent(new Event('input'));

    (Array.from(h.el.querySelectorAll('[data-filter="estado"] button')).find(b => text(b) === 'En prueba') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['b']);
    (Array.from(h.el.querySelectorAll('[data-filter="estado"] button')).find(b => text(b) === 'Todos') as HTMLButtonElement).click();

    (Array.from(h.el.querySelectorAll('[data-filter="plan"] button')).find(b => text(b) === 'PREMIUM') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['a']);
    (Array.from(h.el.querySelectorAll('[data-filter="plan"] button')).find(b => text(b) === 'Todos') as HTMLButtonElement).click();

    h.component.today = new Date('2026-10-26T10:00:00Z');
    const signup = h.el.querySelector('[data-filter="alta"] select') as HTMLSelectElement;
    signup.value = '365';
    signup.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['a']);
  });

  it('ordena por MRR descendente', async () => {
    const h = await mount();
    const sort = h.el.querySelector('[data-sort] select') as HTMLSelectElement;
    sort.value = 'mrr';
    sort.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['b', 'a']);
    (h.el.querySelector('[data-sort-dir]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(rows(h).map(r => r.dataset['id'])).toEqual(['a', 'b']);
  });

  it('una fila abre la misma ficha 360° que Administradores de fincas', async () => {
    const h = await mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    rows(h)[1].click();
    expect(navigate).toHaveBeenCalledWith(['/a/admins', 'b']);
  });

  it('«Nuevas oportunidades» lista solo las abiertas, con origen y plan de interés', async () => {
    const h = await mount();
    const items = Array.from(h.el.querySelectorAll('[data-panel="leads"] [data-lead]'));
    expect(items.map(i => (i as HTMLElement).dataset['lead'])).toEqual(['l1', 'l2']);
    expect(text(items[0])).toContain('Referido');
    expect(text(items[0])).toContain('STANDARD');
    expect(text(items[1])).toContain('Solicitud de alta de comunidad');
    expect(text(items[1])).toContain('Residencial Luna');
  });

  it('«Clientes en riesgo» muestra motivo, próxima renovación y salud, y abre la ficha', async () => {
    const h = await mount();
    const items = Array.from(h.el.querySelectorAll<HTMLElement>('[data-panel="risk"] [data-risk]'));
    expect(items.map(i => i.dataset['risk'])).toEqual(['b']);
    expect(text(items[0])).toContain('Uso muy bajo');
    expect(text(items[0])).toContain('Sin renovación próxima');
    expect(text(items[0])).toContain('42');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    items[0].click();
    expect(navigate).toHaveBeenCalledWith(['/a/admins', 'b']);
  });

  it('«Nuevo cliente» crea una oportunidad y la añade al panel', async () => {
    const h = await mount();
    press(h.el.querySelector('[data-action="new-lead"]'));
    h.fixture.detectChanges();
    const dialog = h.el.querySelector('app-lead-dialog')!;
    const name = dialog.querySelector('[data-field="name"]') as HTMLInputElement;
    name.value = 'Fincas Sur';
    name.dispatchEvent(new Event('input'));
    const origin = dialog.querySelector('[data-field="origin"]') as HTMLSelectElement;
    origin.value = 'web';
    origin.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    press(dialog.querySelector('[data-action="save-lead"]'));
    const post = h.http.expectOne(`${API}/leads`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toMatchObject({ name: 'Fincas Sur', origin: 'web' });
    post.flush(rawLead({ id: 'l9', name: 'Fincas Sur', origin: 'web' }));
    await settle();
    h.http.expectOne(`${API}/leads`).flush([...RAW_LEADS, rawLead({ id: 'l9', name: 'Fincas Sur', origin: 'web' })]);
    await refresh(h);
    expect(h.el.querySelector('app-lead-dialog')).toBeNull();
    expect(text(h.el.querySelector('[data-panel="leads"] [data-lead="l9"]'))).toContain('Fincas Sur');
  });

  it('la ficha de una oportunidad muestra y añade seguimiento comercial', async () => {
    const h = await mount();
    (h.el.querySelector('[data-panel="leads"] [data-lead="l1"]') as HTMLElement).click();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/leads/l1`).flush({ ...rawLead(), followUps: [{ id: 'f1', occurredAt: '2026-10-21T10:00:00Z', text: 'Primera llamada', author: 'Comercial' }] });
    await refresh(h);
    const dialog = h.el.querySelector('app-lead-dialog')!;
    expect(text(dialog.querySelector('[data-followups]'))).toContain('Primera llamada');
    const note = dialog.querySelector('[data-field="followup"]') as HTMLTextAreaElement;
    note.value = 'Enviada la propuesta';
    note.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    press(dialog.querySelector('[data-action="add-followup"]'));
    const post = h.http.expectOne(`${API}/leads/l1/follow-ups`);
    expect(post.request.body).toEqual({ text: 'Enviada la propuesta' });
    post.flush({ id: 'f2', occurredAt: '2026-10-26T10:00:00Z', text: 'Enviada la propuesta', author: 'Comercial' });
    await refresh(h);
    expect(text(dialog.querySelector('[data-followups]'))).toContain('Enviada la propuesta');
  });

  it('«Convertir en cliente» crea el despacho, recarga la lista y abre su invitación', async () => {
    const h = await mount();
    (h.el.querySelector('[data-panel="leads"] [data-lead="l1"]') as HTMLElement).click();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/leads/l1`).flush({ ...rawLead(), followUps: [] });
    await refresh(h);
    const dialog = h.el.querySelector('app-lead-dialog')!;
    press(dialog.querySelector('[data-action="start-convert"]'));
    h.fixture.detectChanges();
    const cif = dialog.querySelector('[data-field="cif"]') as HTMLInputElement;
    cif.value = 'B99999999';
    cif.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    press(dialog.querySelector('[data-action="convert"]'));
    const post = h.http.expectOne(`${API}/leads/l1/convert`);
    expect(post.request.body).toEqual({ cif: 'B99999999', plan: 'STANDARD' });
    post.flush({ administratorId: 'new-admin', lead: rawLead({ status: 'convertido' }) });
    await settle();
    h.http.expectOne(`${API}/admins`).flush([...RAW_ADMINS]);
    h.http.expectOne(`${API}/client-health/offices`).flush(RAW_HEALTH);
    h.http.expectOne(`${API}/clients/overview`).flush(RAW_OVERVIEW);
    h.http.expectOne(`${API}/leads`).flush(RAW_LEADS.slice(1));
    await refresh(h);
    expect(h.el.querySelector('app-lead-dialog')).toBeNull();
    expect(h.el.querySelector('app-admin-invite-dialog')).not.toBeNull();
    h.http.expectOne(`${API}/auth/admin-invites`).flush({ token: 't' });
    await refresh(h);
  });

  it('la próxima acción de un cliente se edita sin abrir la ficha', async () => {
    const h = await mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    press(rows(h)[1].querySelector('[data-action="edit-next-action"]'));
    h.fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    h.http.expectOne(`${API}/clients/b/follow-ups`).flush([]);
    await refresh(h);
    const dialog = h.el.querySelector('app-client-dialog')!;
    const action = dialog.querySelector('[data-field="nextAction"]') as HTMLInputElement;
    action.value = 'Llamar tras la prueba';
    action.dispatchEvent(new Event('input'));
    const date = dialog.querySelector('[data-field="nextActionAt"]') as HTMLInputElement;
    date.value = '2026-11-10';
    date.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    press(dialog.querySelector('[data-action="save-next-action"]'));
    const put = h.http.expectOne(`${API}/clients/b/next-action`);
    expect(put.request.body).toEqual({ nextAction: 'Llamar tras la prueba', nextActionAt: '2026-11-10' });
    put.flush({});
    await settle();
    h.http.expectOne(`${API}/clients/overview`).flush({
      ...RAW_OVERVIEW,
      clients: [RAW_OVERVIEW.clients[0], { ...RAW_OVERVIEW.clients[1], nextAction: 'Llamar tras la prueba', nextActionAt: '2026-11-10' }],
    });
    await refresh(h);
    expect(h.el.querySelector('app-client-dialog')).toBeNull();
    expect(text(rows(h)[1].querySelector('[data-col="accion"]'))).toContain('Llamar tras la prueba');
  });

  it('si fallan los datos comerciales o la salud, la tabla se muestra igual con «—»', async () => {
    const h = await mount({ overview: 'error', health: 'error' });
    expect(rows(h)).toHaveLength(2);
    expect(text(kpi(h, 'Clientes activos')?.querySelector('.stat-card__value'))).toBe('—');
    expect(text(kpi(h, 'Churn risk')?.querySelector('.stat-card__value'))).toBe('—');
    expect(text(rows(h)[0].querySelector('[data-col="salud"]'))).toBe('—');
    expect(text(h.el.querySelector('[data-load-error]'))).toContain('No se pudieron cargar');
  });
});
