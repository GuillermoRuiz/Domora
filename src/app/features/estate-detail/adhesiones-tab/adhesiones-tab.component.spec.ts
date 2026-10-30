import { API, setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import { AdhesionesTabComponent } from './adhesiones-tab.component';
import type { AdhesionRequest, OwnerProperty } from '../../../core/models';

function makeRequest(overrides: Partial<AdhesionRequest> & { user?: { fullName: string; email: string } } = {}): AdhesionRequest {
  return {
    id: 'r1', estateId: 'e1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario',
    submittedAt: '2026-03-01T10:00:00.000Z', status: 'pending',
    user: { fullName: 'Ana García', email: 'ana@test.com' },
    ...overrides,
  } as AdhesionRequest;
}

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return {
    id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado',
    ref: '1-2A', quotaMonthly: 100, balance: 0, pendingDocs: 0, openIssues: 0,
    ...overrides,
  } as OwnerProperty;
}

describe('AdhesionesTabComponent', () => {
  let h: ComponentHarness<AdhesionesTabComponent>;

  beforeEach(() => {
    h = setupComponent(AdhesionesTabComponent);
    h.component.estateId = 'e1';
    h.component.requests = [makeRequest()];
    h.component.properties = [makeProperty()];
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  it('renderiza las tarjetas de solicitud con nombre, propiedad y fecha', () => {
    expect(h.el.querySelectorAll('.request-card')).toHaveLength(1);
    expect(h.el.querySelector('.request-card__name')?.textContent).toContain('Ana García');
    expect(h.el.querySelector('.request-card__email')?.textContent).toContain('ana@test.com');
    expect(h.el.textContent).toContain('Piso 1-2A');
    expect(h.el.textContent).toContain('01-03-2026');
  });

  it('sin solicitudes muestra el estado vacío', () => {
    h.component.requests = [];
    h.fixture.componentRef.changeDetectorRef.detectChanges();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.no-requests')).not.toBeNull();
  });

  it('aprobar una solicitud hace POST, avisa al padre y notifica', async () => {
    const resolved = vi.fn();
    h.component.resolved.subscribe(resolved);

    const promise = h.component.approve(h.component.requests[0]);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests/r1/approve` && r.method === 'POST').flush(null);
    await promise;
    h.fixture.detectChanges();

    expect(resolved).toHaveBeenCalledWith('r1');
    expect(h.el.querySelector('.toast')?.textContent).toContain('aprobada');
  });

  it('rechazar una solicitud hace POST y avisa al padre', async () => {
    const resolved = vi.fn();
    h.component.resolved.subscribe(resolved);

    const promise = h.component.reject(h.component.requests[0]);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests/r1/reject` && r.method === 'POST').flush(null);
    await promise;
    h.fixture.detectChanges();

    expect(resolved).toHaveBeenCalledWith('r1');
    expect(h.el.querySelector('.toast')?.textContent).toContain('rechazada');
  });

  it('si el POST falla no avisa al padre (la solicitud sigue en el listado)', async () => {
    const resolved = vi.fn();
    h.component.resolved.subscribe(resolved);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const promise = h.component.approve(h.component.requests[0]);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/adhesion-requests/r1/approve`)
      .flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
    await promise;

    expect(resolved).not.toHaveBeenCalled();
  });
});
