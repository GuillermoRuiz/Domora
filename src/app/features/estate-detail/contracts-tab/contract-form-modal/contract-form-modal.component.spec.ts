import { API, setupComponent, settle } from '../../../../core/testing/component-harness';
import type { EstateContract } from '../../../../core/models';
import { ContractFormModalComponent } from './contract-form-modal.component';

const SUPPLIERS = [
  { id: 's1', name: 'Schindler', category: 'Ascensores', status: 'Activo' },
  { id: 's2', name: 'Limpiezas Madrid', category: 'Limpieza', status: 'Activo' },
  { id: 's3', name: 'Proveedor de baja', category: 'Otros', status: 'Baja' },
];
const suppliersUrl = `${API}/estates/e1/suppliers`;

function existing(over: Partial<EstateContract> = {}): EstateContract {
  return {
    id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor', startDate: '2025-01-01', endDate: '2026-12-31', renewalType: 'manual',
    costAmount: 1200, costFrequency: 'ANNUAL', currency: 'EUR', reviewFrequency: 'Anual', notes: 'Nota', contractNumber: '0987654321', status: 'Activo', createdAt: '', updatedAt: '',
    supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 200, ...over,
  };
}

describe('ContractFormModalComponent', () => {
  async function mount(contract: EstateContract | null = null) {
    const h = setupComponent(ContractFormModalComponent);
    h.component.estateId = 'e1';
    h.component.contract = contract;
    h.fixture.detectChanges();
    h.http.expectOne(suppliersUrl).flush(SUPPLIERS);
    await settle();
    h.fixture.detectChanges();
    const saved: unknown[] = [];
    h.component.saved.subscribe((c) => saved.push(c));
    return { h, saved };
  }
  const apiContract = { id: 'c9', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor', startDate: '2026-01-01', status: 'Activo', renewalType: 'tacita' };

  it('al crear ofrece solo los proveedores activos de la finca', async () => {
    const { h } = await mount();
    expect(h.el.querySelector('#cf-title')?.textContent).toBe('Nuevo contrato');
    const options = Array.from(h.el.querySelectorAll('#cf-supplier option')).map((o) => o.textContent?.replace(/\s+/g, ' ').trim());
    expect(options).toEqual(['Elige un proveedor', 'Schindler · Ascensores', 'Limpiezas Madrid · Limpieza']);
  });

  it('exige proveedor y tipo de servicio y no envía nada si faltan', async () => {
    const { h, saved } = await mount();
    await h.component.submit();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Elige el proveedor del contrato.');
    expect(h.el.textContent).toContain('Indica el tipo de servicio.');
    h.http.verify();
    expect(saved).toEqual([]);
  });

  it('elegir proveedor propone su categoría como servicio y la cadencia de revisión sugerida, sin pisar lo escrito', async () => {
    const { h } = await mount();
    h.component.onSupplierChange('s1');
    expect(h.component.serviceType()).toBe('Ascensores');
    expect(h.component.reviewFrequency()).toContain('Cuatrimestral');
    h.component.serviceType.set('Mantenimiento propio');
    h.component.onSupplierChange('s2');
    expect(h.component.serviceType()).toBe('Mantenimiento propio');
  });

  it('crea el contrato con los datos del formulario y lo emite', async () => {
    const { h, saved } = await mount();
    h.component.onSupplierChange('s1');
    h.component.startDate.set('2026-01-01');
    h.component.endDate.set('2026-12-31');
    h.component.renewalType.set('manual');
    h.component.costAmount.set(300);
    h.component.costFrequency.set('MONTHLY');
    h.component.notes.set('  Primera contratación ');
    h.component.contractNumber.set(' POL-123 ');
    const promise = h.component.submit();
    const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      serviceType: 'Ascensores', startDate: '2026-01-01', endDate: '2026-12-31', renewalType: 'manual', costAmount: 300, costFrequency: 'MONTHLY', currency: 'EUR', notes: 'Primera contratación', contractNumber: 'POL-123',
    });
    req.flush(apiContract);
    await promise;
    expect(saved).toHaveLength(1);
  });

  it('al editar fija el proveedor, precarga los datos y vaciar la fecha de fin la quita (null)', async () => {
    const { h, saved } = await mount(existing());
    expect(h.el.querySelector('#cf-title')?.textContent).toBe('Editar contrato');
    expect(h.el.querySelector('#cf-supplier')).toBeNull();
    expect(h.component.serviceType()).toBe('Ascensor');
    expect(h.component.endDate()).toBe('2026-12-31');
    expect(h.component.contractNumber()).toBe('0987654321');
    h.component.endDate.set('');
    h.component.notes.set('Otra nota');
    h.component.contractNumber.set('');
    const promise = h.component.submit();
    const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts/c1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.endDate).toBeNull();
    expect(req.request.body.notes).toBe('Otra nota');
    expect(req.request.body.contractNumber).toBeNull();
    req.flush(apiContract);
    await promise;
    expect(saved).toHaveLength(1);
  });

  it('al editar no pisa la cadencia de revisión ya ajustada', async () => {
    const { h } = await mount(existing({ reviewFrequency: 'A mi manera' }));
    h.component.onServiceTypeChange('Ascensor nuevo');
    expect(h.component.reviewFrequency()).toBe('A mi manera');
  });

  it('valida fechas, importe y moneda antes de enviar', async () => {
    const { h } = await mount(existing());
    h.component.endDate.set('2024-01-01');
    await h.component.submit();
    expect(h.component.error()).toBe('La fecha de fin no puede ser anterior a la de inicio.');
    h.component.endDate.set('2026-12-31');
    h.component.costAmount.set(-5);
    await h.component.submit();
    expect(h.component.error()).toBe('El coste debe ser un importe mayor o igual a cero.');
    h.component.costAmount.set(5);
    h.component.currency.set('EU');
    await h.component.submit();
    expect(h.component.error()).toContain('moneda ISO');
    h.http.verify();
  });

  it('si el backend rechaza el contrato muestra su mensaje y no lo emite', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { h, saved } = await mount(existing());
    const promise = h.component.submit();
    h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts/c1`).flush({ message: ['Fecha inválida'] }, { status: 400, statusText: 'Bad Request' });
    await promise;
    expect(h.component.error()).toBe('Fecha inválida');
    expect(saved).toEqual([]);
    expect(h.component.saving()).toBe(false);
  });

  it('sin proveedores activos lo explica', async () => {
    const h = setupComponent(ContractFormModalComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    h.http.expectOne(suppliersUrl).flush([]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('no tiene proveedores activos');
  });
});
