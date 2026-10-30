import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateContract } from '../../../core/models';
import { ContractsTabComponent } from './contracts-tab.component';

function contract(overrides: Partial<EstateContract> = {}): EstateContract {
  return {
    id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensores',
    startDate: '2024-03-01', endDate: '2027-03-01', renewalType: 'tacita', status: 'Activo',
    createdAt: '2024-03-01', updatedAt: '2024-03-01',
    supplier: { id: 's1', name: 'Ascensores Levante', category: 'Ascensores' }, daysLeft: 200,
    ...overrides,
  };
}

describe('ContractsTabComponent', () => {
  let h: ComponentHarness<ContractsTabComponent>;
  const url = `${API}/estates/e1/contracts`;

  async function mount(body: EstateContract[] | { status: number }, renewals: unknown[] = []) {
    h = setupComponent(ContractsTabComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne(url);
    h.http.expectOne(`${url}/renewals`).flush(renewals);
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
  const row = (id: string) => h.el.querySelector(`[data-contract="${id}"]`) as HTMLElement;

  afterEach(() => h.http.verify());

  const DATA = [
    contract({ id: 'late', serviceType: 'Extintores', status: 'Vencido', daysLeft: -5, endDate: '2026-10-10', supplier: { id: 's2', name: 'Protección Turia', category: 'PCI' } }),
    contract({ id: 'soon', status: 'PorVencer', daysLeft: 1, endDate: '2026-10-17' }),
    contract({ id: 'ok' }),
    contract({ id: 'open', endDate: null, daysLeft: null }),
    contract({ id: 'off', status: 'Cancelado', daysLeft: 20, renewalType: 'manual' }),
  ];

  it('las cuatro fichas cuentan activos (con por vencer), vencen pronto, renovaciones tácitas e importe anual de los vigentes', async () => {
    await mount([
      ...DATA.map((c) => ({ ...c, annualCost: c.id === 'ok' ? 3600 : null })),
    ]);
    const kpi = (key: string) => text(h.el.querySelector(`[data-kpi="${key}"]`));
    expect(h.el.querySelectorAll('[data-kpi]')).toHaveLength(4);
    expect(kpi('active')).toContain('Contratos activos');
    expect(kpi('active')).toContain('3');
    expect(kpi('active')).toContain('de 5 contratos');
    expect(kpi('expiring')).toContain('1'); // el por vencer (1 día)
    expect(kpi('expiring')).toContain('en los próximos 90 días');
    expect(text(h.el.querySelector('[data-note="expired"]'))).toBe('1 vencido');
    expect(kpi('auto')).toContain('Renovaciones automáticas');
    expect(kpi('amount')).toMatch(/3600,00/);
    expect(kpi('amount')).toContain('importes según contrato');
    expect(text(h.el.querySelector('[data-note="amount"]'))).toContain('+2 sin importe anual');
  });

  it('el bloque «Requieren atención» ya no existe (D9)', async () => {
    await mount(DATA);
    expect(h.el.querySelector('[data-alert]')).toBeNull();
    expect(h.el.textContent).not.toContain('Requieren atención');
  });

  it('pulsar una ficha filtra la tabla y volver a pulsarla quita el filtro', async () => {
    await mount(DATA);
    expect(h.el.querySelectorAll('[data-contract]')).toHaveLength(5);
    (h.el.querySelector('[data-kpi="active"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    // activos = activos + por vencer (el vencido y el cancelado salen)
    expect(Array.from(h.el.querySelectorAll('[data-contract]')).map((r) => r.getAttribute('data-contract')).sort()).toEqual(['ok', 'open', 'soon']);
    expect(h.el.querySelector('[data-kpi="active"]')?.getAttribute('aria-pressed')).toBe('true');
    (h.el.querySelector('[data-kpi="active"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('[data-contract]')).toHaveLength(5);
    expect(h.el.querySelector('[data-kpi="active"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('si ningún contrato coincide lo dice y ofrece quitar los filtros', async () => {
    await mount(DATA);
    (h.el.querySelector('[data-kpi="auto"]') as HTMLButtonElement).click(); // activos con tácita
    h.component.filters.update((f) => ({ ...f, search: 'zzz' }));
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Ningún contrato coincide con los filtros');
    (h.el.querySelector('.contracts__link') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('[data-contract]')).toHaveLength(5);
  });

  it('la tabla muestra una fila por contrato con sus datos en formato español', async () => {
    await mount(DATA);
    expect(h.el.querySelectorAll('[data-contract]')).toHaveLength(5);
    expect(text(row('ok'))).toContain('01/03/2024');
    expect(text(row('ok'))).toContain('01/03/2027');
    expect(text(row('ok'))).toContain('Automática');
    expect(text(row('ok'))).toContain('Activo');
    expect(text(row('open'))).toContain('Indefinido');
    expect(text(row('open'))).toContain('Sin vencimiento');
    expect(text(row('off'))).toContain('Manual');
    expect(text(row('off'))).toContain('Cancelado');
  });

  it('sin contratos lo dice y ofrece ir a Proveedores', async () => {
    await mount([]);
    expect(h.el.textContent).toContain('aún no tiene contratos');
    const opened = vi.fn();
    h.component.openProviders.subscribe(opened);
    (h.el.querySelector('.contracts__link') as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('si falla la carga muestra un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });

  it('lee los filtros de la URL al abrir', async () => {
    h = setupComponent(ContractsTabComponent, {
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ vig: 'vencidos', orden: 'proveedor' }) } } }],
    });
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    h.http.expectOne(url).flush(DATA);
    h.http.expectOne(`${url}/renewals`).flush([]);
    await settle();
    h.fixture.detectChanges();
    expect(h.component.filters().vigencia).toBe('vencidos');
    expect(h.component.filters().sort).toBe('proveedor');
    expect(Array.from(h.el.querySelectorAll('[data-contract]')).map((r) => r.getAttribute('data-contract'))).toEqual(['late']);
  });

  it('escribe los filtros en la URL (sin añadir historial y conservando la pestaña), con un pequeño retardo', async () => {
    await mount(DATA);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const search = h.el.querySelector('#contracts-search') as HTMLInputElement;
    for (const value of ['a', 'as', 'asc']) {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(navigate).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(navigate).toHaveBeenCalledTimes(1); // las pulsaciones seguidas se agrupan
    const [commands, extras] = navigate.mock.calls[0] as [unknown[], { queryParams: Record<string, string | null>; queryParamsHandling: string; replaceUrl: boolean }];
    expect(commands).toEqual([]);
    expect(extras.queryParams['tab']).toBe('contracts');
    expect(extras.queryParams['q']).toBe('asc');
    expect(extras.queryParams['vig']).toBeNull();
    expect(extras.queryParamsHandling).toBe('merge');
    expect(extras.replaceUrl).toBe(true);
  });

  it('el buscador filtra la tabla sin acentos', async () => {
    await mount(DATA);
    const search = h.el.querySelector('#contracts-search') as HTMLInputElement;
    search.value = 'proteccion turia';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    h.fixture.detectChanges();
    expect(Array.from(h.el.querySelectorAll('[data-contract]')).map((r) => r.getAttribute('data-contract'))).toEqual(['late']);
  });

  describe('gestión de contratos (D1, D2, D3)', () => {
    const supplierUrl = `${API}/estates/e1/suppliers/s1`;
    const reloaded = async (contracts: EstateContract[] = DATA) => {
      h.http.expectOne(url).flush(contracts);
      h.http.expectOne(`${url}/renewals`).flush([]);
      await settle();
      h.fixture.detectChanges();
    };
    const openMenu = (id: string, action: string) => {
      (row(id).querySelector('.table__more') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      (h.el.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
      h.fixture.detectChanges();
    };

    it('«Ver» abre el detalle del contrato y lo cierra', async () => {
      await mount(DATA);
      (row('ok').querySelector('.table__view') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne(`${supplierUrl}/documents`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contract-detail')).not.toBeNull();
      (h.el.querySelector('.drawer__close') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contract-detail')).toBeNull();
    });

    it('«Nuevo contrato» abre el formulario de alta', async () => {
      await mount(DATA);
      (h.el.querySelector('.toolbar__new button') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('#cf-title')?.textContent).toBe('Nuevo contrato');
    });

    it('editar desde «⋯» abre el formulario con el contrato y al guardar recarga la lista y avisa', async () => {
      await mount(DATA);
      openMenu('ok', 'edit');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('#cf-title')?.textContent).toBe('Editar contrato');
      const saving = h.el.querySelector<HTMLFormElement>('app-contract-form-modal form')!;
      saving.dispatchEvent(new Event('submit'));
      h.http.expectOne(`${supplierUrl}/contracts/ok`).flush({ id: 'ok', supplierId: 's1', status: 'Activo' });
      await settle();
      await reloaded();
      expect(h.el.querySelector('app-contract-form-modal')).toBeNull();
      expect(text(h.el.querySelector('.contracts__toast'))).toBe('Contrato actualizado');
    });

    it('renovar: abre el diálogo, envía la renovación y refresca la lista y el histórico', async () => {
      await mount(DATA);
      openMenu('ok', 'renew');
      expect(h.el.querySelector('#cr-title')?.textContent).toBe('Renovar contrato');
      h.component.dialog.set({ kind: 'renew', contract: DATA[2]! });
      const modal = h.fixture.debugElement.query((d) => d.name === 'app-contract-renew-modal').componentInstance as { newEnd: { set(v: string): void }; submit(): Promise<void> };
      modal.newEnd.set('2099-01-01');
      const promise = modal.submit();
      h.http.expectOne(`${supplierUrl}/contracts/ok/renew`).flush({ contract: { id: 'ok', supplierId: 's1', status: 'Activo' }, renewal: { id: 'r1' } });
      await promise;
      await settle();
      await reloaded();
      expect(h.el.querySelector('app-contract-renew-modal')).toBeNull();
      expect(text(h.el.querySelector('.contracts__toast'))).toBe('Contrato renovado');
    });

    it('cancelar: pide confirmación y, al confirmar, recarga y avisa; «Volver» no toca nada', async () => {
      await mount(DATA);
      openMenu('ok', 'cancel');
      expect(h.el.querySelector('#cc-title')?.textContent).toBe('Cancelar contrato');
      (h.el.querySelectorAll('app-contract-cancel-modal app-btn button')[0] as HTMLButtonElement).click(); // Volver
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contract-cancel-modal')).toBeNull();
      openMenu('ok', 'cancel');
      (h.el.querySelectorAll('app-contract-cancel-modal app-btn button')[1] as HTMLButtonElement).click(); // Cancelar contrato
      h.http.expectOne(`${supplierUrl}/contracts/ok/cancel`).flush({ id: 'ok', supplierId: 's1', status: 'Cancelado' });
      await settle();
      await reloaded();
      expect(text(h.el.querySelector('.contracts__toast'))).toBe('Contrato cancelado');
    });

    it('«Ver proveedor» cierra el diálogo y lleva a la pestaña Proveedores', async () => {
      await mount(DATA);
      const opened = vi.fn();
      h.component.openProviders.subscribe(opened);
      openMenu('ok', 'supplier');
      expect(opened).toHaveBeenCalledTimes(1);
      expect(h.component.dialog()).toBeNull();
    });

    it('si falla el histórico de renovaciones la tabla se sigue viendo', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      h = setupComponent(ContractsTabComponent);
      h.component.estateId = 'e1';
      h.fixture.detectChanges();
      h.http.expectOne(url).flush(DATA);
      h.http.expectOne(`${url}/renewals`).flush({}, { status: 500, statusText: 'Error' });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelectorAll('[data-contract]')).toHaveLength(5);
      expect(h.el.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('paneles inferiores (D3, D4, D10)', () => {
    const RENEWALS = [
      { id: 'r1', contractId: 'ok', serviceType: 'Ascensores', supplier: { id: 's1', name: 'Ascensores Levante', category: 'Ascensores' }, renewedAt: '2026-01-10', previousEndDate: '2026-01-10', newEndDate: '2027-01-10', annualCost: 3600, currency: 'EUR', kind: 'manual' },
    ];

    it('muestra próximos vencimientos y últimas renovaciones, y «Ver histórico» abre el listado completo', async () => {
      await mount(DATA, RENEWALS);
      expect(h.el.querySelector('app-contracts-panels')).not.toBeNull();
      expect(h.el.querySelectorAll('[data-upcoming]').length).toBeGreaterThan(0);
      expect(h.el.querySelector('[data-renewal="r1"]')).not.toBeNull();
      const history = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.section-card__action')).find((b) => b.textContent?.includes('Ver histórico'));
      history!.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('#rh-title')?.textContent).toBe('Histórico de renovaciones');
      (h.el.querySelector('.close-btn') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contract-renewals-history')).toBeNull();
    });

    it('«Ver» de un vencimiento abre el detalle de ese contrato', async () => {
      await mount(DATA);
      (h.el.querySelector('[data-upcoming] .panels__view') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/suppliers/s1/documents`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-contract-detail')).not.toBeNull();
    });

    it('«Ver todos» filtra los vigentes y los ordena por vencimiento', async () => {
      await mount(DATA);
      const all = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.section-card__action')).find((b) => b.textContent?.includes('Ver todos'));
      all!.click();
      h.fixture.detectChanges();
      expect(h.component.filters().vigencia).toBe('activos');
      expect(h.component.filters().sort).toBe('vencimiento_asc');
      expect(Array.from(h.el.querySelectorAll('.contracts__card [data-contract]')).map((r) => r.getAttribute('data-contract')).sort()).toEqual(['ok', 'open', 'soon']);
    });
  });
});
