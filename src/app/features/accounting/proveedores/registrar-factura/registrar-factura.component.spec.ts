import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import { RegistrarFacturaComponent } from './registrar-factura.component';
import type { Supplier } from '../../../../core/models';

const SUPPLIERS = [
  { id: 's1', name: 'Arquitectura Norte', category: 'Administración', status: 'Activo', taxId: 'B1' },
  { id: 's2', name: 'Ascensores XYZ', category: 'Mantenimiento', status: 'Activo' },
  { id: 's3', name: 'De baja', category: 'Otros', status: 'Baja' },
] as Supplier[];

const ACCOUNTS = [
  { id: 'a622', code: '622', name: 'Reparaciones y conservación', postable: true },
  { id: 'a623', code: '623', name: 'Servicios de profesionales independientes', postable: true },
  { id: 'a700', code: '700', name: 'Cuotas', postable: true },
  { id: 'a6', code: '6', name: 'Gastos', postable: false },
];

describe('RegistrarFacturaComponent', () => {
  let h: ComponentHarness<RegistrarFacturaComponent>;

  beforeEach(() => {
    h = setupComponent(RegistrarFacturaComponent);
    h.component.estateId = 'e1';
    h.component.suppliers = SUPPLIERS;
  });

  afterEach(() => h.http.verify());

  async function mount(supplierId = ''): Promise<void> {
    h.component.supplierId = supplierId;
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush(ACCOUNTS);
    h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([{ id: 'cc1', name: 'Garaje', status: 'Activo' }]);
    await settle();
    h.fixture.detectChanges();
  }

  it('solo ofrece cuentas de gasto que admiten apuntes y proveedores activos; propone la cuenta por categoría', async () => {
    await mount('s1');
    expect(h.component.expenseAccounts().map((a) => a.code)).toEqual(['622', '623']);
    expect(h.component.activeSuppliers().map((s) => s.id)).toEqual(['s1', 's2']);
    expect(h.component.lines()[0].accountId).toBe('a623');

    h.component.onSupplierChange('s2');
    expect(h.component.lines()[0].accountId).toBe('a622');
  });

  it('calcula en vivo base, IVA, retención, total y lo que se paga', async () => {
    await mount('s1');
    h.component.lines()[0].base = '1.000,00';
    h.component.form.vatRatePct = '21';
    h.component.form.withholdingRatePct = '15';
    h.component.touch();
    expect(h.component.totals()).toEqual({ base: 1000, vat: 210, withholding: 150, total: 1210, payable: 1060 });
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('A pagar al proveedor');

    h.component.lines()[0].base = 'abc';
    h.component.touch();
    expect(h.component.totals()).toBeNull();
  });

  it('no envía nada sin número ni con bases imposibles', async () => {
    await mount('s1');
    h.component.form.concept = 'Informe';
    await h.component.save();
    expect(h.component.error()).toContain('número');
    h.component.form.number = 'F-1';
    h.component.lines()[0].base = '0';
    h.component.touch();
    await h.component.save();
    expect(h.component.error()).toContain('bases');
    h.http.expectNone(`${API}/estates/e1/suppliers/s1/invoices`);
  });

  it('registra con varias líneas, centro de coste y retención, y avisa al cerrar', async () => {
    await mount('s1');
    Object.assign(h.component.form, { number: 'F-2026/14', concept: 'Proyecto de fachada', issueDate: '2026-03-10', dueDate: '2026-04-10', withholdingRatePct: '15' });
    h.component.lines()[0].base = '800';
    h.component.addLine();
    Object.assign(h.component.lines()[1], { accountId: 'a622', costCentreId: 'cc1', base: '200,50', description: 'Garaje' });
    h.component.touch();

    const closed: unknown[] = [];
    h.component.closed.subscribe((e) => closed.push(e));
    const save = h.component.save();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/s1/invoices` && r.method === 'POST');
    expect(req.request.body).toEqual({
      number: 'F-2026/14', concept: 'Proyecto de fachada', issueDate: '2026-03-10', dueDate: '2026-04-10',
      vatRatePct: 21, withholdingRatePct: 15, withholdingKey: 'G_profesional', payableAccount: '400',
      lines: [
        { accountId: 'a623', baseAmount: 800 },
        { accountId: 'a622', costCentreId: 'cc1', description: 'Garaje', baseAmount: 200.5 },
      ],
    });
    req.flush({ id: 'i1', lines: [] });
    await save;
    expect(closed).toEqual([{ saved: true, supplierId: 's1', invoiceId: 'i1' }]);
  });

  it('muestra el motivo si el backend lo rechaza', async () => {
    await mount('s1');
    Object.assign(h.component.form, { number: 'F-1', concept: 'x' });
    h.component.lines()[0].base = '10';
    h.component.touch();
    const save = h.component.save();
    h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices`).flush({ message: 'Ya hay una factura F-1 de este proveedor.' }, { status: 409, statusText: 'Conflict' });
    await save;
    expect(h.component.error()).toContain('Ya hay una factura');
  });
});
