import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import { PagarProveedorComponent } from './pagar-proveedor.component';
import type { SupplierInvoice } from '../../../../core/models';

function inv(id: string, outstanding: number, status: SupplierInvoice['status'], dueDate: string | null = null): SupplierInvoice {
  return {
    id, supplierId: 's1', supplierName: 'X', number: id.toUpperCase(), concept: 'x', issueDate: '2026-01-01', receivedDate: '2026-01-01',
    dueDate, baseAmount: 0, vatRatePct: 0, vatAmount: 0, withholdingRatePct: 0, withholdingAmount: 0, withholdingKey: null,
    total: outstanding, payable: outstanding, payableAccount: '400', status, outstanding, cancelReason: null, lines: [],
  };
}

describe('PagarProveedorComponent', () => {
  let h: ComponentHarness<PagarProveedorComponent>;

  beforeEach(() => {
    h = setupComponent(PagarProveedorComponent);
    h.component.estateId = 'e1';
    h.component.supplierId = 's1';
    h.component.supplierName = 'Ascensores XYZ';
    h.component.invoices = [
      inv('b', 200, 'Registrada', '2026-05-31'),
      inv('a', 100, 'Parcial', '2026-04-30'),
      inv('pagada', 0, 'Pagada'),
      inv('anulada', 0, 'Anulada'),
    ];
  });

  afterEach(() => h.http.verify());

  async function mount(invoiceId: string | null = null, banks: unknown[] = [{ id: 'b1', alias: 'Principal', isDefault: true, closedAt: null, balance: 0 }]) {
    h.component.invoiceId = invoiceId;
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush(banks);
    await settle();
    h.fixture.detectChanges();
  }

  it('ofrece solo las pendientes, ordenadas por vencimiento, y propone pagar todo lo elegido', async () => {
    await mount();
    expect(h.component.open().map((i) => i.id)).toEqual(['a', 'b']);
    expect(h.component.amount()).toBe('300,00');
    h.component.toggle('b', false);
    expect(h.component.amount()).toBe('100,00');
  });

  it('con una factura elegida, solo esa', async () => {
    await mount('b');
    expect([...h.component.selected()]).toEqual(['b']);
    expect(h.component.amount()).toBe('200,00');
  });

  it('pago parcial por banco con las facturas elegidas', async () => {
    await mount();
    h.component.amount.set('150,50');
    const closed: unknown[] = [];
    h.component.closed.subscribe((e) => closed.push(e));
    const save = h.component.save();
    const req = h.http.expectOne(`${API}/estates/e1/supplier-payments`);
    expect(req.request.body).toEqual({
      supplierId: 's1', date: expect.any(String), amount: 150.5, method: 'Transferencia', bankAccountId: 'b1', invoiceIds: ['a', 'b'],
    });
    req.flush({});
    await save;
    expect(closed).toEqual([{ saved: true, message: 'Pago de 150,50 € registrado' }]);
  });

  it('no deja pagar de más ni sin facturas; en efectivo no manda banco', async () => {
    await mount();
    h.component.amount.set('301');
    await h.component.save();
    expect(h.component.error()).toContain('supera lo pendiente');
    h.component.toggle('a', false);
    h.component.toggle('b', false);
    await h.component.save();
    expect(h.component.error()).toContain('al menos una factura');
    h.http.expectNone(`${API}/estates/e1/supplier-payments`);

    h.component.toggle('a', true);
    h.component.form.method = 'Efectivo';
    const save = h.component.save();
    const req = h.http.expectOne(`${API}/estates/e1/supplier-payments`);
    expect(req.request.body.bankAccountId).toBeUndefined();
    expect(req.request.body.method).toBe('Efectivo');
    req.flush({});
    await save;
  });
});
