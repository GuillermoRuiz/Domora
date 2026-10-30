import { API, setupComponent, settle, typeInto } from '../../core/testing/component-harness';
import { DashboardAComponent } from './dashboard-a.component';
import type { Administrator, EstateOnboardingRequest, OfficeHealth } from '../../core/models';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

function makeAdmin(overrides: Partial<Administrator> = {}): Administrator {
  return {
    id: 'ad1', name: 'Fincas García', cif: 'B12345678', plan: 'STANDARD', tier: 'standard',
    endDate: '2026-12-31', usersActive: 10, usersMax: 100, status: 'Activa',
    phone: '600000000', contactName: 'Pedro García', contactEmail: 'pedro@garcia.com',
    mrr: 99, discountPct: 0, billingInterval: 'month', notes: '', billing: null, fincas: [], invoices: [], activity: [],
    clientStatus: 'Activo', paymentStatus: 'Al día',
    pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 },
    ...overrides,
  };
}

function makeHealth(overrides: Partial<OfficeHealth> = {}): OfficeHealth {
  return {
    administratorId: 'ad1', name: 'Fincas García', plan: 'STANDARD', createdAt: '2026-01-01',
    clientStatus: 'Activo', paymentStatus: 'Al día', completeness: 80, salud: 92, atRisk: false, motivo: null,
    signals: [], usage: { activeDays: 10, activeUsers: 2, staffUsers: 2, observedDays: 30 }, attention: [],
    ...overrides,
  };
}

function makeOnboarding(overrides: Partial<EstateOnboardingRequest> = {}): EstateOnboardingRequest {
  return {
    id: 'ob1', communityName: 'Comunidad Nueva', status: 'pending', createdAt: '2026-01-01',
    requestedByName: 'Juan Vecino', requestedByEmail: 'juan@vecino.com',
    ...overrides,
  };
}

async function flushInitialLoad(
  http: any,
  admins: Administrator[],
  onboarding: EstateOnboardingRequest[] = [],
  health: OfficeHealth[] | 'error' = [],
): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/admins`).flush(admins);
  http.expectOne((r: any) => r.url === `${API}/estate-onboarding-requests`).flush(onboarding);
  const healthReq = http.expectOne((r: any) => r.url === `${API}/client-health/offices`);
  if (health === 'error') healthReq.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
  else healthReq.flush({ atRiskBelow: 70, churnRisk: 0, offices: health });
  await settle();
}

function cell(el: HTMLElement, column: string, row = 0): HTMLElement {
  return el.querySelectorAll('tbody tr')[row].querySelector(`[data-col="${column}"]`) as HTMLElement;
}

describe('DashboardAComponent', () => {
  it('carga administradores/onboarding/catálogo al montar y refleja los KPIs', async () => {
    const { fixture, http, el } = setupComponent(DashboardAComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [
      makeAdmin({ id: 'a1', cif: 'B1', mrr: 100, status: 'Activa' }),
      makeAdmin({ id: 'a2', cif: 'B2', mrr: 50, status: 'Periodo de gracia' }),
      makeAdmin({ id: 'a3', cif: 'B3', mrr: 0, status: 'Vencida' }),
    ]);
    fixture.detectChanges();

    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    const stats = el.querySelectorAll('.stat-card__value');
    expect(stats[0].textContent?.trim()).toBe('150,00 €');
    expect(stats[1].textContent?.trim()).toBe('3');
    expect(stats[2].textContent?.trim()).toBe('1');
    expect(stats[3].textContent?.trim()).toBe('1');
  });

  it('sin administradores, la tabla muestra el estado vacío', async () => {
    const { fixture, http, el } = setupComponent(DashboardAComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, []);
    fixture.detectChanges();

    expect(el.querySelector('.td--empty')?.textContent).toContain('No se encontraron administradores');
  });

  describe('columnas de estado (S6, S10, S14)', () => {
    it('Estado shows the client status, including «En onboarding»', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeAdmin({ clientStatus: 'En onboarding' })]);
      fixture.detectChanges();

      expect(cell(el, 'estado').textContent?.trim()).toBe('En onboarding');
    });

    it('Pago shows the payment status and, when something is owed, the pending amount', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [
        makeAdmin({ id: 'a1', cif: 'B1', paymentStatus: 'Pendiente', pendingInvoices: { count: 2, amount: 121.5, overdueCount: 0, overdueAmount: 0 } }),
        makeAdmin({ id: 'a2', cif: 'B2', paymentStatus: 'Al día' }),
      ]);
      fixture.detectChanges();

      expect(cell(el, 'pago', 0).textContent).toContain('Pendiente');
      expect(cell(el, 'pago', 0).textContent).toContain('121,50 €');
      expect(cell(el, 'pago', 0).textContent).toContain('2 facturas');
      expect(cell(el, 'pago', 1).textContent?.trim()).toBe('Al día');
    });

    it('Completitud shows the despacho percentage with a bar', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeAdmin({ id: 'ad1' })], [], [makeHealth({ administratorId: 'ad1', completeness: 62.5 })]);
      fixture.detectChanges();

      expect(cell(el, 'completitud').textContent).toContain('63 %');
      expect(cell(el, 'completitud').querySelector('app-progress-bar')).not.toBeNull();
    });

    it('Salud shows the index and, below the threshold, «En riesgo» with its motive on focus', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeAdmin({ id: 'ad1' })], [], [
        makeHealth({ administratorId: 'ad1', salud: 55.6, atRisk: true, motivo: { code: 'payment', label: 'Pagos pendientes' } }),
      ]);
      fixture.detectChanges();

      const salud = cell(el, 'salud');
      expect(salud.textContent).toContain('56');
      const tag = salud.querySelector('.risk-tag') as HTMLElement;
      expect(tag.textContent).toContain('En riesgo');
      expect(tag.getAttribute('tabindex')).toBe('0');
      expect(tag.getAttribute('aria-label')).toBe('En riesgo: Pagos pendientes');
      expect(tag.querySelector('[role="tooltip"]')?.textContent).toContain('Pagos pendientes');
    });

    it('a healthy despacho shows no «En riesgo» tag', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeAdmin({ id: 'ad1' })], [], [makeHealth({ administratorId: 'ad1', salud: 92 })]);
      fixture.detectChanges();

      expect(cell(el, 'salud').textContent).toContain('92');
      expect(cell(el, 'salud').querySelector('.risk-tag')).toBeNull();
    });

    it('if salud cannot be loaded, the list still renders with «—» in Completitud and Salud', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [makeAdmin({ id: 'ad1' })], [], 'error');
      fixture.detectChanges();

      expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(cell(el, 'completitud').textContent?.trim()).toBe('—');
      expect(cell(el, 'salud').textContent?.trim()).toBe('—');
    });
  });

  describe('filtros', () => {
    it('la búsqueda filtra por nombre, CIF o contacto', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [
        makeAdmin({ id: 'a1', cif: 'B1', name: 'Fincas García' }),
        makeAdmin({ id: 'a2', cif: 'B2', name: 'Urbanizaciones Norte' }),
      ]);
      fixture.detectChanges();
      expect(el.querySelectorAll('tbody tr')).toHaveLength(2);

      typeInto(el, '.search-input', 'norte');
      fixture.detectChanges();

      const rows = el.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('Urbanizaciones Norte');
    });

    it('el filtro de plan y de estado del cliente se combinan (AND)', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [
        makeAdmin({ id: 'a1', cif: 'B1', name: 'A', plan: 'PREMIUM', clientStatus: 'Activo' }),
        makeAdmin({ id: 'a2', cif: 'B2', name: 'B', plan: 'PREMIUM', clientStatus: 'Suspendido' }),
        makeAdmin({ id: 'a3', cif: 'B3', name: 'C', plan: 'BASE', clientStatus: 'Activo' }),
      ]);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('.filter-chip')).find((b) => b.textContent?.trim() === 'PREMIUM') as HTMLElement).click();
      (Array.from(el.querySelectorAll('[data-filter="estado"] .filter-chip')).find((b) => b.textContent?.trim() === 'Activo') as HTMLElement).click();
      fixture.detectChanges();

      const rows = el.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('A');
    });

    it('the payment filter keeps only despachos with that payment status', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [
        makeAdmin({ id: 'a1', cif: 'B1', name: 'Al corriente', paymentStatus: 'Al día' }),
        makeAdmin({ id: 'a2', cif: 'B2', name: 'Moroso', paymentStatus: 'Vencido' }),
      ]);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('[data-filter="pago"] .filter-chip')).find((b) => b.textContent?.trim() === 'Vencido') as HTMLElement).click();
      fixture.detectChanges();

      const rows = el.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('Moroso');
    });
  });

  it('clicking a row opens the ficha 360° of that despacho', async () => {
    const { fixture, http, el } = setupComponent(DashboardAComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeAdmin({ id: 'ad9', cif: 'B9' })]);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('tbody tr') as HTMLElement).click();

    expect(navigate).toHaveBeenCalledWith(['/a/admins', 'ad9']);
    expect(el.querySelector('.drawer')).toBeNull();
  });

  it('pressing Enter on a focused row also opens the ficha', async () => {
    const { fixture, http, el } = setupComponent(DashboardAComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, [makeAdmin({ id: 'ad9', cif: 'B9' })]);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const row = el.querySelector('tbody tr') as HTMLElement;
    expect(row.getAttribute('tabindex')).toBe('0');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(navigate).toHaveBeenCalledWith(['/a/admins', 'ad9']);
  });

  it('«Añadir administrador» creates the despacho and shows its invitation link', async () => {
    const { fixture, http, el } = setupComponent(DashboardAComponent);
    fixture.detectChanges();
    await flushInitialLoad(http, []);
    fixture.detectChanges();

    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Añadir administrador')) as HTMLElement).click();
    fixture.detectChanges();
    const inputs = el.querySelectorAll<HTMLInputElement>('.modal .form-input');
    for (const [i, value] of ['Fincas Nuevas', 'B99999999', 'hola@nuevas.es'].entries()) {
      inputs[i].value = value;
      inputs[i].dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Crear administradora')) as HTMLElement).click();

    const post = http.expectOne((r: any) => r.url === `${API}/admins` && r.method === 'POST');
    expect(post.request.body).toMatchObject({ name: 'Fincas Nuevas', cif: 'B99999999', contactEmail: 'hola@nuevas.es' });
    post.flush(makeAdmin({ id: 'new1', name: 'Fincas Nuevas' }));
    await settle();
    http.expectOne((r: any) => r.url === `${API}/admins` && r.method === 'GET').flush([makeAdmin({ id: 'new1', name: 'Fincas Nuevas' })]);
    await settle();
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/auth/admin-invites`).flush({ token: 'tok123' });
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.invite-link-box__value')?.textContent).toContain('/invite/tok123');
  });

  describe('solicitudes de alta (onboarding)', () => {
    it('el badge de la pestaña refleja las solicitudes pendientes', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [], [makeOnboarding({ status: 'pending' }), makeOnboarding({ id: 'ob2', status: 'contacted' })]);
      fixture.detectChanges();

      expect(el.querySelector('.page-tab__badge')?.textContent?.trim()).toBe('1');
    });

    it('marcar como contactada actualiza el estado sin recargar toda la página', async () => {
      const { fixture, http, el } = setupComponent(DashboardAComponent);
      fixture.detectChanges();
      await flushInitialLoad(http, [], [makeOnboarding({ id: 'ob1', status: 'pending' })]);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('.page-tab')).find((b) => b.textContent?.includes('Solicitudes de alta')) as HTMLElement).click();
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Marcar contactada')) as HTMLElement).click();

      const patchReq = http.expectOne((r: any) => r.url === `${API}/estate-onboarding-requests/ob1` && r.method === 'PATCH');
      expect(patchReq.request.body).toEqual({ status: 'contacted' });
      patchReq.flush(null);
      await settle();
      http.expectOne((r: any) => r.url === `${API}/estate-onboarding-requests`).flush([makeOnboarding({ id: 'ob1', status: 'contacted' })]);
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('.toast')?.textContent).toContain('contactada');
      expect(el.textContent).not.toContain('Marcar contactada');
    });
  });
});
