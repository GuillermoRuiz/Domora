import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { CASH, TesoreriaTabComponent } from './tesoreria-tab.component';

const BASE = `${API}/estates/e1/bank-accounts/b1`;

function bank(overrides: Record<string, unknown> = {}): any {
  return { id: 'b1', alias: 'Principal', accountCode: '5720001', ibanMasked: null, isDefault: true, closedAt: null, balance: '0', ...overrides };
}

function line(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'l1', date: '2026-03-01', entryId: 'j1', entryNumber: 1, fiscalYear: 2026, sourceType: 'treasury',
    concept: 'Comisión', counterparts: ['626 Servicios bancarios'], amount: -9.5, balance: 90.5, reconciliationGroupId: null,
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}): any {
  return { id: 's1', date: '2026-03-01', concept: 'COMISION', amount: -9.5, bankRef: null, reconciliationGroupId: null, statementId: 'st1', ...overrides };
}

const ACCOUNTS = [
  { id: 'a626', estateId: 'e1', code: '626', name: 'Servicios bancarios', postable: true, allowsCostCentre: false },
  { id: 'a622', estateId: 'e1', code: '622', name: 'Reparaciones', postable: true, allowsCostCentre: true },
  { id: 'a759', estateId: 'e1', code: '759', name: 'Ingresos por servicios diversos', postable: true, allowsCostCentre: true },
  { id: 'a430', estateId: 'e1', code: '430', name: 'Propietarios', postable: true, requiresProperty: true },
  { id: 'a6', estateId: 'e1', code: '62', name: 'Servicios exteriores', postable: false },
];

describe('TesoreriaTabComponent', () => {
  let h: ComponentHarness<TesoreriaTabComponent>;

  beforeEach(() => {
    h = setupComponent(TesoreriaTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount(opts: { banks?: any[]; lines?: any[]; entries?: any[]; lastStatement?: any } = {}) {
    h.fixture.detectChanges();
    const banks = opts.banks ?? [bank()];
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush(banks);
    h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush(ACCOUNTS);
    h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([{ id: 'cc1', name: 'Piscina', status: 'Activo' }]);
    await settle();
    if (banks.length) await flushReload(opts);
    h.fixture.detectChanges();
  }

  async function flushReload(opts: { banks?: any[]; lines?: any[]; entries?: any[]; lastStatement?: any } = {}) {
    const lines = opts.lines ?? [line()];
    const closing = lines.length ? lines[lines.length - 1].balance : 0;
    h.http.expectOne((r) => r.url === `${BASE}/ledger`).flush({ bankAccountId: 'b1', alias: 'Principal', openingBalance: 0, closingBalance: closing, lines });
    h.http.expectOne((r) => r.url === `${BASE}/statement`).flush({ entries: opts.entries ?? [entry()], lastStatement: opts.lastStatement ?? null });
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush(opts.banks ?? [bank()]);
    await settle();
    h.fixture.detectChanges();
  }

  it('sin cuentas bancarias explica qué hacer y no pide ningún mayor', async () => {
    await mount({ banks: [] });
    expect(h.el.textContent).toContain('no tiene cuentas bancarias');
  });

  it('muestra el mayor del banco por defecto, lo más reciente primero, y avisa si no cuadra con el extracto', async () => {
    await mount({
      lines: [line({ id: 'l0', date: '2026-01-01', concept: 'Saldo', amount: 100, balance: 100 }), line()],
      lastStatement: { id: 'st1', fileName: 'marzo.n43', periodFrom: '2026-03-01', periodTo: '2026-03-31', closingBalance: 100, importedAt: '2026-04-01' },
    });
    const rows = h.el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Comisión');
    expect(rows[1].textContent).toContain('Saldo');
    expect(h.component.statementGap()).toBe(-9.5);
    expect(h.el.textContent).toContain('difieren');
    expect(h.component.pendingLines()).toHaveLength(2);
  });

  it('solo concilia cuando lo marcado de cada lado suma lo mismo', async () => {
    await mount({ lines: [line(), line({ id: 'l2', amount: -3, balance: 87.5 })], entries: [entry()] });
    h.component.enterReconcile();
    h.component.toggleEntry('s1');
    h.component.toggleLine('l1');
    h.component.toggleLine('l2');
    expect(h.component.selectionDiff()).toBe(3);
    expect(h.component.canMatch()).toBe(false);

    h.component.toggleLine('l2');
    expect(h.component.canMatch()).toBe(true);
    const done = h.component.matchSelection();
    const req = h.http.expectOne(`${BASE}/reconciliations`);
    expect(req.request.body).toEqual({ entryIds: ['s1'], lineIds: ['l1'] });
    req.flush({ groupId: 'g1' });
    await settle();
    await flushReload({ lines: [line({ reconciliationGroupId: 'g1' })], entries: [entry({ reconciliationGroupId: 'g1' })] });
    await done;
    expect(h.component.selectedEntries().size).toBe(0);
    expect(h.component.reconciledGroups()).toEqual([
      expect.objectContaining({ id: 'g1', entries: [expect.objectContaining({ id: 's1' })], lines: [expect.objectContaining({ id: 'l1' })] }),
    ]);
  });

  it('muestra el error del backend si la conciliación no cuadra', async () => {
    await mount();
    h.component.toggleEntry('s1');
    h.component.toggleLine('l1');
    const done = h.component.matchSelection();
    h.http.expectOne(`${BASE}/reconciliations`).flush({ message: 'DM080: los importes no cuadran.' }, { status: 409, statusText: 'Conflict' });
    await done;
    expect(h.component.matchError()).toContain('no cuadran');
  });

  it('deshacer una conciliación borra el grupo y recarga', async () => {
    await mount({ lines: [line({ reconciliationGroupId: 'g1' })], entries: [entry({ reconciliationGroupId: 'g1' })] });
    const done = h.component.unmatch('g1');
    h.http.expectOne(`${API}/reconciliations/g1`).flush({ unmatched: true });
    await settle();
    await flushReload();
    await done;
    expect(h.component.pendingLines()).toHaveLength(1);
  });

  it('un pago suelto va contra una cuenta de gasto; los ingresos salen primero al cobrar', async () => {
    await mount();
    h.component.openQuick('out');
    expect(h.component.quickAccounts().map((a) => a.code)).toEqual(['626', '622', '759']);
    h.component.quickForm.direction = 'in';
    h.component.touchQuick();
    expect(h.component.quickAccounts()[0].code).toBe('759');
  });

  it('registra un pago desde el banco con su centro de coste si la cuenta lo admite', async () => {
    await mount();
    h.component.openQuick('out');
    Object.assign(h.component.quickForm, { accountId: 'a622', costCentreId: 'cc1', amount: '1.234,50', concept: 'Bomba piscina' });
    h.component.touchQuick();
    expect(h.component.quickAllowsCostCentre()).toBe(true);

    const done = h.component.saveQuick();
    const req = h.http.expectOne(`${API}/estates/e1/treasury/entries`);
    expect(req.request.body).toEqual({
      date: h.component.quickForm.date, direction: 'out', amount: 1234.5, bankAccountId: 'b1',
      counterpartAccountId: 'a622', costCentreId: 'cc1', concept: 'Bomba piscina',
    });
    req.flush({});
    await settle();
    await flushReload();
    await done;
    expect(h.component.showQuick()).toBe(false);
  });

  it('en caja no manda cuenta bancaria, y valida el importe antes de enviar', async () => {
    await mount();
    h.component.openQuick('in');
    Object.assign(h.component.quickForm, { place: CASH, accountId: 'a759', amount: '0', concept: 'Alquiler de sala' });
    await h.component.saveQuick();
    expect(h.component.quickError()).toContain('importe');

    h.component.quickForm.amount = '50';
    const done = h.component.saveQuick();
    const req = h.http.expectOne(`${API}/estates/e1/treasury/entries`);
    expect(req.request.body.bankAccountId).toBeUndefined();
    expect(req.request.body.direction).toBe('in');
    req.flush({});
    await settle();
    await flushReload();
    await done;
  });

  it('un traspaso necesita origen y destino distintos', async () => {
    await mount();
    h.component.openTransfer();
    expect(h.component.transferForm).toEqual(expect.objectContaining({ from: 'b1', to: CASH }));
    Object.assign(h.component.transferForm, { to: 'b1', amount: '100' });
    await h.component.saveTransfer();
    expect(h.component.transferError()).toContain('distintos');

    h.component.transferForm.to = CASH;
    const done = h.component.saveTransfer();
    const req = h.http.expectOne(`${API}/estates/e1/treasury/transfers`);
    expect(req.request.body).toEqual({ date: h.component.transferForm.date, amount: 100, fromBankAccountId: 'b1' });
    req.flush({});
    await settle();
    await flushReload();
    await done;
  });

  it('al importar el extracto informa de lo importado y de los avisos del fichero', async () => {
    await mount();
    const file = new File(['11...'], 'marzo.n43');
    const input = { files: [file], value: 'marzo.n43' } as unknown as HTMLInputElement;
    const done = h.component.onStatementFile({ target: input } as unknown as Event);
    h.http.expectOne(`${BASE}/statements`).flush({
      statementId: 'st1', imported: 3, skippedDuplicates: 1, openingBalance: 0, closingBalance: 90.5,
      warnings: ['El saldo final del fichero no cuadra con sus movimientos.'],
    });
    await settle();
    await flushReload();
    await done;
    expect(input.value).toBe('');
    expect(h.component.toastMessage()).toBe('3 partidas importadas (1 ya estaban importadas)');
    expect(h.el.textContent).toContain('no cuadra con sus movimientos');
  });
});
