import { API, setupComponent } from '../../../../core/testing/component-harness';
import type { EstateContract } from '../../../../core/models';
import { ContractRenewModalComponent, plusOneYear } from './contract-renew-modal.component';

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function contract(over: Partial<EstateContract> = {}): EstateContract {
  return {
    id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor', startDate: '2024-01-01', endDate: isoDay(20), renewalType: 'tacita',
    costAmount: 1200, costFrequency: 'ANNUAL', currency: 'EUR', status: 'PorVencer', createdAt: '', updatedAt: '',
    supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 20, ...over,
  };
}
const url = `${API}/estates/e1/suppliers/s1/contracts/c1/renew`;

describe('plusOneYear', () => {
  it('suma un año y ajusta el 29 de febrero', () => {
    expect(plusOneYear('2026-03-15')).toBe('2027-03-15');
    expect(plusOneYear('2028-02-29')).toBe('2029-03-01');
  });
});

describe('ContractRenewModalComponent', () => {
  function mount(c: EstateContract = contract()) {
    const h = setupComponent(ContractRenewModalComponent);
    h.component.estateId = 'e1';
    h.component.contract = c;
    h.fixture.detectChanges();
    const renewed: unknown[] = [];
    h.component.renewed.subscribe((x) => renewed.push(x));
    return { h, renewed };
  }

  it('propone un año más sobre el vencimiento actual y precarga el importe', () => {
    const { h } = mount();
    expect(h.component.newEnd()).toBe(plusOneYear(isoDay(20)));
    expect(h.component.costAmount()).toBe(1200);
    expect(h.component.costFrequency()).toBe('ANNUAL');
    expect(h.el.querySelector('[data-current]')?.textContent).toContain('Vencimiento actual');
  });

  it('si el contrato ya venció propone un año desde hoy', () => {
    const { h } = mount(contract({ endDate: isoDay(-40), status: 'Vencido', daysLeft: -40 }));
    expect(h.component.newEnd()).toBe(plusOneYear(isoDay(0)));
  });

  it('exige un nuevo vencimiento posterior al actual y no envía nada si no', async () => {
    const { h } = mount();
    h.component.newEnd.set(isoDay(10));
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-error="end"]')?.textContent).toBe('Debe ser posterior al vencimiento actual.');
    await h.component.submit();
    h.component.newEnd.set('');
    await h.component.submit();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-error="end"]')?.textContent).toBe('Indica el nuevo vencimiento.');
    h.http.verify();
  });

  it('en un contrato vencido hace falta además que sea posterior a hoy', () => {
    const { h } = mount(contract({ endDate: isoDay(-200), status: 'Vencido', daysLeft: -200 }));
    h.component.newEnd.set(isoDay(-100));
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-error="end"]')?.textContent).toBe('Debe ser posterior a hoy.');
  });

  it('solo envía el nuevo vencimiento si el importe no cambia', async () => {
    const { h, renewed } = mount();
    const promise = h.component.submit();
    const req = h.http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newEndDate: plusOneYear(isoDay(20)) });
    req.flush({ contract: { id: 'c1', supplierId: 's1', status: 'Activo' }, renewal: { id: 'r1' } });
    await promise;
    expect(renewed).toHaveLength(1);
  });

  it('si cambia el importe o la periodicidad los envía, junto con las notas', async () => {
    const { h } = mount();
    h.component.costAmount.set(1300);
    h.component.costFrequency.set('MONTHLY');
    h.component.notes.set('  Subida del IPC ');
    const promise = h.component.submit();
    const req = h.http.expectOne(url);
    expect(req.request.body).toEqual({ newEndDate: plusOneYear(isoDay(20)), costAmount: 1300, costFrequency: 'MONTHLY', notes: 'Subida del IPC' });
    req.flush({ contract: { id: 'c1', supplierId: 's1', status: 'Activo' }, renewal: {} });
    await promise;
  });

  it('muestra el mensaje del backend si rechaza la renovación', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { h, renewed } = mount();
    const promise = h.component.submit();
    h.http.expectOne(url).flush({ message: 'El nuevo vencimiento debe ser posterior al vencimiento actual.' }, { status: 400, statusText: 'Bad Request' });
    await promise;
    expect(h.component.error()).toBe('El nuevo vencimiento debe ser posterior al vencimiento actual.');
    expect(renewed).toEqual([]);
  });
});
