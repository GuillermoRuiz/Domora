import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import { IngresosSinIdentificarComponent } from './ingresos-sin-identificar.component';
import type { OwnerProperty } from '../../../../core/models';

const PROPERTY = { id: 'p1', type: 'Piso', staircase: '1', floor: '2', door: 'A' } as OwnerProperty;

function rawItem(overrides: Record<string, unknown> = {}): any {
  return {
    id: 's1', date: '2026-02-05T00:00:00.000Z', amount: 150, concept: 'TRANSF. SIN REFERENCIA',
    bankAccountId: 'b1', bankAccountAlias: 'Principal', applied: 0, remaining: 150, applications: [],
    ...overrides,
  };
}

describe('IngresosSinIdentificarComponent', () => {
  let h: ComponentHarness<IngresosSinIdentificarComponent>;

  beforeEach(() => {
    h = setupComponent(IngresosSinIdentificarComponent);
    h.component.estateId = 'e1';
    h.component.properties = [PROPERTY];
  });

  afterEach(() => h.http.verify());

  async function load(items: any[] = [rawItem()]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/suspense`).flush(items);
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([{ id: 'b1', alias: 'Principal', isDefault: true, closedAt: null, balance: '0' }]);
    await settle();
    h.fixture.detectChanges();
  }

  it('lista los ingresos y el total pendiente de aplicar', async () => {
    await load([rawItem(), rawItem({ id: 's2', remaining: 20, applied: 30, amount: 50, applications: [{ id: 'c1', propertyId: 'p1', amount: 30, date: '2026-02-09' }] })]);
    expect(h.component.pendingTotal()).toBe(170);
    expect(h.el.textContent).toContain('TRANSF. SIN REFERENCIA');
    expect(h.el.textContent).toContain('Aplicado 30,00 € a 1-2-A');
  });

  it('registrar un ingreso exige importe y concepto, y manda el banco por defecto', async () => {
    await load([]);
    h.component.showNew.set(true);
    h.component.newForm = { date: '2026-02-05', amount: '', concept: '', bankAccountId: 'b1' };
    await h.component.register();
    expect(h.component.error()).toContain('importe');

    h.component.newForm = { date: '2026-02-05', amount: '1.234,50', concept: 'Ingreso', bankAccountId: 'b1' };
    const register = h.component.register();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suspense` && r.method === 'POST');
    expect(req.request.body).toEqual({ date: '2026-02-05', amount: 1234.5, concept: 'Ingreso', bankAccountId: 'b1' });
    req.flush({});
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suspense` && r.method === 'GET').flush([rawItem({ amount: 1234.5, remaining: 1234.5 })]);
    await register;
    expect(h.component.showNew()).toBe(false);
  });

  it('aplicar a una propiedad no deja pasar de lo que queda y, al cerrar, avisa de que hubo cambios', async () => {
    await load();
    h.component.openApply(h.component.items()[0]);
    h.component.applyForm = { propertyId: 'p1', amount: '200', date: '2026-02-08' };
    await h.component.apply();
    expect(h.component.error()).toContain('150,00');

    h.component.applyForm = { propertyId: 'p1', amount: '100', date: '2026-02-08' };
    const apply = h.component.apply();
    const req = h.http.expectOne(`${API}/suspense/s1/apply`);
    expect(req.request.body).toEqual({ propertyId: 'p1', amount: 100, date: '2026-02-08' });
    req.flush({});
    await settle();
    h.http.expectOne(`${API}/estates/e1/suspense`).flush([rawItem({ remaining: 50, applied: 100 })]);
    await apply;
    expect(h.component.applying()).toBeNull();

    const closed: { changed: boolean }[] = [];
    h.component.closed.subscribe((e) => closed.push(e));
    h.component.close();
    expect(closed).toEqual([{ changed: true }]);
  });
});
