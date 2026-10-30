import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { NominasTabComponent } from './nominas-tab.component';

const YEAR = new Date().getFullYear();

function payroll(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'p1', staffMemberId: 's1', staffName: 'Portero Pérez', staffNationalId: '00000000T', position: 'Conserje',
    period: `${YEAR}-02`, kind: 'mensual', accrualDate: `${YEAR}-02-28`, grossSalary: 1500, employeeSs: 97.5, employerSs: 480,
    irpfWithholding: 150, netPay: 1252.5, totalCost: 1980, status: 'Registrada', paidDate: null, cancelReason: null, notes: null,
    ...overrides,
  };
}

describe('NominasTabComponent', () => {
  let h: ComponentHarness<NominasTabComponent>;

  beforeEach(() => {
    h = setupComponent(NominasTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount(opts: { payrolls?: any[]; settlements?: any[]; staff?: any[] } = {}) {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/staff`).flush(opts.staff ?? [
      { id: 's1', fullName: 'Portero Pérez', position: 'Conserje', status: 'Activo', monthlyCost: 1500, startDate: '2020-01-01' },
    ]);
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([{ id: 'b1', alias: 'Principal', isDefault: true, closedAt: null, balance: 0 }]);
    await settle();
    await flushReload(opts);
  }

  async function flushReload(opts: { payrolls?: any[]; settlements?: any[] } = {}) {
    h.http.expectOne((r) => r.url === `${API}/estates/e1/payroll`).flush(opts.payrolls ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax-settlements`).flush(opts.settlements ?? []);
    await settle();
    h.fixture.detectChanges();
  }

  it('lista las nóminas del año con sus totales; las anuladas no cuentan', async () => {
    await mount({
      payrolls: [payroll(), payroll({ id: 'p2', status: 'Anulada', cancelReason: 'Error' }), payroll({ id: 'p3', period: `${YEAR}-03`, status: 'Pagada', paidDate: `${YEAR}-04-01` })],
    });
    expect(h.component.totals()).toEqual({ cost: 3960, irpf: 300, ss: 1155, unpaid: 1252.5 });
    expect(h.el.textContent).toContain('Portero Pérez');
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('registrar precarga el bruto del empleado, calcula el neto y manda los importes', async () => {
    await mount();
    h.component.openNew();
    h.component.onStaffChange('s1');
    expect(h.component.newForm.gross).toBe('1500');
    Object.assign(h.component.newForm, { period: `${YEAR}-05`, employeeSs: '97,50', employerSs: '480', irpf: '150' });
    h.component.touchNew();
    expect(h.component.newNet()).toBe(1252.5);

    const save = h.component.saveNew();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/payroll` && r.method === 'POST');
    expect(req.request.body).toEqual({
      staffMemberId: 's1', period: `${YEAR}-05`, kind: 'mensual', grossSalary: 1500, employeeSs: 97.5, employerSs: 480, irpfWithholding: 150,
    });
    req.flush(payroll());
    await settle();
    await flushReload({ payrolls: [payroll()] });
    await save;
    expect(h.component.showNew()).toBe(false);
    expect(h.component.toastMessage()).toContain('Nómina registrada');
  });

  it('no deja registrar una nómina con retención mayor que el bruto', async () => {
    await mount();
    h.component.openNew();
    Object.assign(h.component.newForm, { staffMemberId: 's1', gross: '100', irpf: '150' });
    h.component.touchNew();
    await h.component.saveNew();
    expect(h.component.newError()).toContain('no pueden superar el bruto');
    h.http.expectNone((r) => r.method === 'POST');
  });

  it('pagar, deshacer el pago y anular', async () => {
    await mount({ payrolls: [payroll()] });
    h.component.openPay(h.component.payrolls()[0]);
    const pay = h.component.confirmPay();
    const p = h.http.expectOne(`${API}/payroll/p1/pay`);
    expect(p.request.body).toEqual({ date: expect.any(String), method: 'Transferencia', bankAccountId: 'b1' });
    p.flush(payroll({ status: 'Pagada' }));
    await settle();
    await flushReload({ payrolls: [payroll({ status: 'Pagada', paidDate: `${YEAR}-03-01` })] });
    await pay;

    h.component.openReason({ kind: 'undo', payroll: h.component.payrolls()[0] });
    await h.component.confirmReason();
    expect(h.component.reasonError()).toContain('motivo');
    h.component.reason.set('Transferencia devuelta');
    const undo = h.component.confirmReason();
    h.http.expectOne(`${API}/payroll/p1/undo-payment`).flush(payroll());
    await settle();
    await flushReload({ payrolls: [payroll()] });
    await undo;

    h.component.openReason({ kind: 'cancel', payroll: h.component.payrolls()[0] });
    h.component.reason.set('Importes equivocados');
    const cancel = h.component.confirmReason();
    h.http.expectOne(`${API}/payroll/p1/cancel`).flush(payroll({ status: 'Anulada' }));
    await settle();
    await flushReload({ payrolls: [payroll({ status: 'Anulada' })] });
    await cancel;
    expect(h.component.toastMessage()).toContain('anulada');
  });

  it('pagar la Seguridad Social propone las cuotas del mes', async () => {
    await mount({ payrolls: [payroll()] });
    h.component.openSs();
    h.component.onSsPeriodChange(`${YEAR}-02`);
    expect(h.component.ssForm.amount).toBe('577,5');
    const save = h.component.confirmSs();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/tax-settlements` && r.method === 'POST');
    expect(req.request.body).toMatchObject({ kind: 'seguridad_social', period: `${YEAR}-02`, amount: 577.5, bankAccountId: 'b1' });
    req.flush({});
    await settle();
    await flushReload({ payrolls: [payroll()], settlements: [{ id: 't1', kind: 'seguridad_social', period: `${YEAR}-02`, date: `${YEAR}-03-31`, amount: 577.5, status: 'Vigente', reference: null }] });
    await save;
    expect(h.component.ssPayments()).toHaveLength(1);
  });
});
