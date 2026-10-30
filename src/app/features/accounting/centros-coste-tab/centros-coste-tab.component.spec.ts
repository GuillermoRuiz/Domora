import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { CentrosCosteTabComponent } from './centros-coste-tab.component';
import type { AccountingEstate, CostCentre } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

function makeCostCentre(overrides: Partial<CostCentre> = {}): CostCentre {
  return {
    id: 'cc1', estateId: 'e1', administratorId: 'a1', name: 'Piscina', description: null,
    status: 'Activo', budgeted: 500, executed: 300, ...overrides,
  };
}

describe('CentrosCosteTabComponent', () => {
  let h: ComponentHarness<CentrosCosteTabComponent>;

  beforeEach(() => {
    h = setupComponent(CentrosCosteTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(centres: CostCentre[]): void {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centres`).flush(centres);
  }

  it('carga los centros de coste al montar, con presupuestado/ejecutado', async () => {
    flushInitialLoad([makeCostCentre({ id: 'cc1', name: 'Piscina' }), makeCostCentre({ id: 'cc2', name: 'Jardín', budgeted: null, executed: 0 })]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(h.el.textContent).toContain('Piscina');
    expect(h.el.textContent).toContain('60%'); // 300/500
  });

  it('sin centros de coste, muestra el estado vacío', async () => {
    flushInitialLoad([]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Todavía no hay centros de coste en esta finca');
  });

  describe('modal "Nuevo centro de coste"', () => {
    it('sin nombre, no envía nada y marca el error', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo centro de coste')) as HTMLElement).click();
      h.fixture.detectChanges();
      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Crear centro de coste')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.ccErrors()).toEqual({ name: true });
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('con nombre, crea el centro de coste y recarga la lista', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      h.component.openNuevo();
      h.component.ccName.set('Ascensor Portal A');

      const submitPromise = h.component.submit();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centres` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ name: 'Ascensor Portal A' });
      req.flush(makeCostCentre({ id: 'cc-nueva', name: 'Ascensor Portal A' }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centres`).flush([makeCostCentre({ id: 'cc-nueva', name: 'Ascensor Portal A' })]);
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showModal()).toBe(false);
      expect(h.el.querySelector('.toast')?.textContent).toContain('creado correctamente');
    });
  });

  describe('archivar', () => {
    it('pide confirmación y envía status: Archivado', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad([makeCostCentre({ id: 'cc1', name: 'Piscina', status: 'Activo' })]);
      await settle();
      h.fixture.detectChanges();

      const promise = h.component.archivar(h.component.centres()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centres/cc1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ status: 'Archivado' });
      req.flush(makeCostCentre({ id: 'cc1', name: 'Piscina', status: 'Archivado' }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/cost-centres`).flush([makeCostCentre({ id: 'cc1', name: 'Piscina', status: 'Archivado' })]);
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('archivado');
    });
  });
});
