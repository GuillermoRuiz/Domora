import { API, setupComponent } from '../../../../core/testing/component-harness';
import type { EstateContract } from '../../../../core/models';
import { ContractCancelModalComponent } from './contract-cancel-modal.component';

const contract: EstateContract = {
  id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor', startDate: '2024-01-01', endDate: '2026-12-31', renewalType: 'tacita',
  status: 'Activo', createdAt: '', updatedAt: '', supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 100,
};
const url = `${API}/estates/e1/suppliers/s1/contracts/c1/cancel`;

describe('ContractCancelModalComponent', () => {
  function mount() {
    const h = setupComponent(ContractCancelModalComponent);
    h.component.estateId = 'e1';
    h.component.contract = contract;
    h.fixture.detectChanges();
    const cancelled: unknown[] = [];
    const closed: unknown[] = [];
    h.component.cancelled.subscribe((c) => cancelled.push(c));
    h.component.closed.subscribe(() => closed.push(1));
    return { h, cancelled, closed };
  }

  it('avisa de lo que implica y cancela con el motivo escrito', async () => {
    const { h, cancelled } = mount();
    expect(h.el.textContent).toContain('pasará a «Cancelado»');
    h.component.reason.set('  Sustituido por otro proveedor ');
    const promise = h.component.confirm();
    const req = h.http.expectOne(url);
    expect(req.request.body).toEqual({ cancelledReason: 'Sustituido por otro proveedor' });
    req.flush({ id: 'c1', supplierId: 's1', status: 'Cancelado' });
    await promise;
    expect(cancelled).toHaveLength(1);
  });

  it('el motivo es opcional', async () => {
    const { h } = mount();
    const promise = h.component.confirm();
    const req = h.http.expectOne(url);
    expect(req.request.body.cancelledReason).toBeUndefined();
    req.flush({ id: 'c1', supplierId: 's1', status: 'Cancelado' });
    await promise;
  });

  it('«Volver» cierra sin llamar a la API y un error se muestra sin emitir', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { h, cancelled, closed } = mount();
    (h.el.querySelectorAll('app-btn button')[0] as HTMLButtonElement).click();
    expect(closed).toHaveLength(1);
    const promise = h.component.confirm();
    h.http.expectOne(url).flush({ message: 'No autorizado' }, { status: 403, statusText: 'Forbidden' });
    await promise;
    expect(h.component.error()).toBe('No autorizado');
    expect(cancelled).toEqual([]);
  });
});
