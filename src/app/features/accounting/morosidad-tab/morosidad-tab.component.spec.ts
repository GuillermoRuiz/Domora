import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { MorosidadTabComponent } from './morosidad-tab.component';
import type { AccountingEstate, DebtorAction, DebtorReminders, NeighbourBalance, PaymentAgreement, PaymentAgreementInstallment } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

/**
 * Fábrica de un `Debtor` TAL COMO LO DEVUELVE EL BACKEND (crudo, antes de
 * `DebtorsService.mapDebtor`) — no la forma ya mapeada. `name`/`reminders`
 * son azúcar de conveniencia que esta fábrica traduce a `titular`/
 * `reminderL1/L2/Bf`, igual que hace el mapper real.
 */
function makeDebtor(overrides: Partial<{
  id: string; propertyId: string; amount: number; interest: number; monthsOverdue: number;
  oldest: string; lastContact: string | null; step: string; name: string; reminders: DebtorReminders;
  propertyRef: string;
}> = {}): any {
  const { name, reminders, propertyId, propertyRef, ...rest } = overrides;
  return {
    id: 'd1', administratorId: 'a1', estateId: 'e1', propertyId: propertyId ?? 'p1',
    amount: 200, interest: 10, monthsOverdue: 3, oldest: '2026-01-01', lastContact: null,
    step: 'Sin gestionar',
    titular: name ?? 'Juan Moroso',
    property: { ref: propertyRef ?? 'Piso 3A', staircase: null, floor: null, door: null },
    reminderL1: reminders?.l1 ?? false, reminderL2: reminders?.l2 ?? false, reminderBf: reminders?.bf ?? false,
    ...rest,
  };
}

function makeAction(overrides: Partial<DebtorAction> = {}): DebtorAction {
  return { id: 'act1', debtorId: 'd1', type: 'Llamada', date: '2026-01-01', note: 'Llamé', result: 'Sin respuesta', author: 'Tú', ...overrides };
}

function makeAgreement(overrides: Partial<PaymentAgreement> = {}): PaymentAgreement {
  return {
    id: 'agr1', debtorId: 'd1', totalAmount: 210, downPaymentAmount: 0, installmentsCount: 3,
    firstDueDate: '2026-04-01', status: 'active' as any, signedAt: '2026-03-01', createdByUserId: 'u1',
    ...overrides,
  };
}

async function flushDrawerOpen(http: any, opts: { agreement?: PaymentAgreement | null; installments?: PaymentAgreementInstallment[]; actions?: DebtorAction[] } = {}): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/debtors/d1/agreement`).flush(opts.agreement ?? null);
  await settle();
  if (opts.agreement) {
    http.expectOne((r: any) => r.url === `${API}/payment-agreements/${opts.agreement!.id}/installments`).flush(opts.installments ?? []);
    await settle();
  }
  http.expectOne((r: any) => r.url === `${API}/debtors/d1/actions`).flush(opts.actions ?? []);
  await settle();
}

describe('MorosidadTabComponent', () => {
  let h: ComponentHarness<MorosidadTabComponent>;

  beforeEach(() => {
    h = setupComponent(MorosidadTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(debtors: any[]): void {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/debtors`).flush(debtors);
  }

  it('carga los morosos al montar y refleja la deuda total (amount + interest)', async () => {
    flushInitialLoad([makeDebtor({ id: 'd1', amount: 200, interest: 10 }), makeDebtor({ id: 'd2', amount: 100, interest: 5, monthsOverdue: 8 })]);
    await settle();
    h.fixture.detectChanges();

    expect(h.component.totalDebt()).toBe(300);
    expect(h.component.totalInterest()).toBe(15);
    expect(h.component.maxMonths()?.id).toBe('d2'); // el de más meses de atraso
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  describe('selección múltiple', () => {
    it('toggleSelect y toggleSelectAll', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' }), makeDebtor({ id: 'd2' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.toggleSelect('d1');
      expect(h.component.selectedCount()).toBe(1);
      expect(h.component.allSelected()).toBe(false);

      h.component.toggleSelectAll();
      expect(h.component.selectedCount()).toBe(2);
      expect(h.component.allSelected()).toBe(true);

      h.component.toggleSelectAll();
      expect(h.component.selectedCount()).toBe(0);
    });
  });

  describe('drawer "Gestionar"', () => {
    it('sin acuerdo activo, carga solo el historial de acciones', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http, { agreement: null, actions: [makeAction()] });
      h.fixture.detectChanges();

      expect(h.component.activeAgreement()).toBeNull();
      expect(h.component.drawerActions()).toHaveLength(1);
    });

    it('registrar una gestión la guarda, actualiza lastContact/step y recarga el historial', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', name: 'Juan Moroso', lastContact: null, step: 'Sin gestionar' })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http);

      h.component.newGestionType.set('Llamada');
      h.component.newGestionDate.set('2026-03-15');
      h.component.newGestionNote.set('Sin respuesta');

      const promise = h.component.saveGestion();
      const req = h.http.expectOne((r: any) => r.url === `${API}/debtors/d1/actions` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ type: 'Llamada', date: '2026-03-15', note: 'Sin respuesta' });
      req.flush(makeAction({ date: '2026-03-15' }));
      await settle();
      await flushDrawerOpen(h.http, { actions: [makeAction({ date: '2026-03-15' })] });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.debtors()[0].lastContact).toBe('2026-03-15');
      expect(h.component.debtors()[0].step).toBe('Aviso enviado');
      expect(h.el.querySelector('.toast')?.textContent).toContain('Juan Moroso');
    });
  });

  describe('acuerdo de pago', () => {
    it('el reparto en cuotas se calcula sobre amount + interest, con la entrada como cuota 0', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', amount: 200, interest: 10 })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http);

      h.component.acuerdoCuotas.set(3);
      h.component.acuerdoEntrada.set(20); // 20% de 210 = 42
      h.component.acuerdoFirstDate.set('2026-04-01');

      const plan = h.component.acuerdoPlan();
      expect(plan).toHaveLength(4); // entrada + 3 cuotas
      expect(plan[0]).toMatchObject({ n: 0, amount: 42 });
      const cuotasSum = plan.slice(1).reduce((s, r) => s + r.amount, 0);
      expect(cuotasSum).toBeCloseTo(168, 5); // 210 - 42
    });

    it('downPaymentAmount = 0 (sin entrada) no rompe el cálculo — no agrega la fila de entrada', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', amount: 200, interest: 10 })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http);

      h.component.acuerdoCuotas.set(3);
      h.component.acuerdoEntrada.set(0);

      const plan = h.component.acuerdoPlan();
      expect(plan).toHaveLength(3); // sin fila de entrada
      const total = plan.reduce((s, r) => s + r.amount, 0);
      expect(total).toBeCloseTo(210, 5);
    });

    it('confirmar el acuerdo persiste el PaymentAgreement real (no una gestión genérica) y actualiza el estado del deudor', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', name: 'Juan Moroso', amount: 200, interest: 10, step: 'Sin gestionar' })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http);
      h.component.acuerdoCuotas.set(3);
      h.component.acuerdoEntrada.set(20);
      h.component.acuerdoFirstDate.set('2026-04-01');

      const promise = h.component.confirmAcuerdo();
      const agreementReq = h.http.expectOne((r: any) => r.url === `${API}/debtors/d1/agreement` && r.method === 'POST');
      expect(agreementReq.request.body).toMatchObject({ totalAmount: 210, downPaymentAmount: 42, installmentsCount: 3 });
      agreementReq.flush(makeAgreement());
      await settle();
      const actionReq = h.http.expectOne((r: any) => r.url === `${API}/debtors/d1/actions` && r.method === 'POST');
      expect(actionReq.request.body).toMatchObject({ result: 'Compromiso de pago' });
      actionReq.flush(makeAction({ result: 'Compromiso de pago' }));
      await settle();
      await flushDrawerOpen(h.http, { agreement: makeAgreement(), installments: [] });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.debtors()[0].step).toBe('Aviso enviado');
      expect(h.el.querySelector('.toast')?.textContent).toContain('Acuerdo de pago confirmado');
    });

    it('marcar una cuota como cobrada la persiste y recarga el drawer', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http, { agreement: makeAgreement({ id: 'agr1' }), installments: [{ id: 'i1', agreementId: 'agr1', seq: 1, dueDate: '2026-04-01', amount: 70 }] });

      const promise = h.component.markInstallmentPaid('i1');
      h.http.expectOne((r: any) => r.url === `${API}/payment-installments/i1/paid` && r.method === 'PATCH').flush(null);
      await settle();
      await flushDrawerOpen(h.http, { agreement: makeAgreement({ id: 'agr1' }), installments: [{ id: 'i1', agreementId: 'agr1', seq: 1, dueDate: '2026-04-01', amount: 70, paidAt: '2026-04-02' }] });
      await promise;

      expect(h.component.toastMessage()).toContain('Cuota cobrada');
    });
  });

  describe('acciones locales (sin backend todavía): reclamación masiva, acción legal', () => {
    it('el wizard de reclamación masiva actualiza los avisos localmente, sin llamar al backend', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', reminders: { l1: false, l2: false, bf: false } })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openBulkWizard();
      h.component.selectBulkType('burofax');
      h.component.bulkSend();

      expect(h.component.debtors()[0].reminders.bf).toBe(true);
      expect(h.component.debtors()[0].step).toBe('En reclamación');
      expect(h.component.bulkWizardOpen()).toBe(false);
      h.http.expectNone((r) => r.method === 'POST' || r.method === 'PATCH');
    });

    it('iniciar acción judicial actualiza el estado localmente y cierra el drawer', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', step: 'Sin gestionar' })]);
      await settle();
      h.fixture.detectChanges();
      h.component.openDrawer(h.component.debtors()[0]);
      await flushDrawerOpen(h.http);

      h.component.startLegalAction();

      expect(h.component.debtors()[0].step).toBe('Acción judicial');
      expect(h.component.drawerDebtor()).toBeNull();
    });

    it('"Enviar reclamación masiva" está deshabilitado — el click no dispara nada', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      const bulkBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Enviar reclamación masiva'))!;
      expect(bulkBtn.disabled).toBe(true);

      bulkBtn.click();
      h.fixture.detectChanges();

      expect(h.component.bulkWizardOpen()).toBe(false);
    });
  });

  describe('Liquidar intereses (fase 10)', () => {
    it('calcula por cada recibo pendiente del deudor y contabiliza al confirmar', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', propertyId: 'p1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openInterestModal();
      const calc = h.component.calculateInterest();
      h.http.expectOne((r: any) => r.url === `${API}/properties/p1/debt-certificate`).flush({
        pendingReceipts: [
          { id: 'r1', no: 'A-1', period: '2026-01', concept: 'Cuota', amount: 100, outstanding: 100, originYear: 2026, isInterest: false, status: 'Pendiente', dueDate: '2026-01-10' },
        ],
        principal: 100, interest: 0, totalDebt: 100, activeAgreement: null, isDebtFree: false,
        estate: { id: 'e1', name: 'x', cif: null },
        property: { id: 'p1', ref: null, staircase: null, floor: null, door: null },
        issuedAt: '2026-03-01', issuedByUserId: 'u1', legalBasis: 'x',
      });
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/late-interest/preview` && r.method === 'POST')
        .flush({ debtReceiptNo: 'A-1', interestStart: '2026-01-15', segments: [], total: 3.5 });
      await calc;
      h.fixture.detectChanges();

      expect(h.component.interestRows()).toHaveLength(1);
      expect(h.component.interestRows()[0].receipts).toEqual([{ receiptId: 'r1', no: 'A-1', amount: 3.5 }]);
      expect(h.component.interestGrandTotal()).toBeCloseTo(3.5);

      const confirm = h.component.confirmInterest();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/late-interest/accrue` && r.method === 'POST')
        .flush({ debtReceiptNo: 'A-1', interestStart: '2026-01-15', segments: [], total: 3.5, interestReceiptId: 'ri1' });
      await confirm;
      h.fixture.detectChanges();

      expect(h.component.interestModalOpen()).toBe(false);
      expect(h.component.toastMessage()).toContain('1 recibo');
    });

    it('sin nada que liquidar (sin política, o todo al día), lo informa sin bloquear', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1', propertyId: 'p1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openInterestModal();
      const calc = h.component.calculateInterest();
      h.http.expectOne((r: any) => r.url === `${API}/properties/p1/debt-certificate`).flush({
        pendingReceipts: [],
        principal: 0, interest: 0, totalDebt: 0, activeAgreement: null, isDebtFree: true,
        estate: { id: 'e1', name: 'x', cif: null },
        property: { id: 'p1', ref: null, staircase: null, floor: null, door: null },
        issuedAt: '2026-03-01', issuedByUserId: 'u1', legalBasis: 'x',
      });
      await calc;
      h.fixture.detectChanges();

      expect(h.component.interestRows()).toHaveLength(0);
      expect(h.component.interestCalculated()).toBe(true);
    });
  });

  describe('"Todos los vecinos" — saldo en vivo', () => {
    it('el toggle carga el saldo de TODA la finca, no solo los morosos ya gestionados', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.setViewMode('all');
      const balances: NeighbourBalance[] = [
        { propertyId: 'p1', property: { ref: '1A', staircase: null, floor: null, door: null }, titular: 'Juan Moroso', email: null, phone: null, balance: 210, advance: 50, isUpToDate: false, debtorId: 'd1', monthsOverdue: 3, step: 'Sin gestionar', lastContact: null, reminderL1: false, reminderL2: false, reminderBf: false },
        { propertyId: 'p2', property: { ref: '2B', staircase: null, floor: null, door: null }, titular: 'Ana Al Día', email: null, phone: null, balance: 0, advance: 0, isUpToDate: true, debtorId: null, monthsOverdue: 0, step: null, lastContact: null, reminderL1: false, reminderL2: false, reminderBf: false },
      ];
      h.http.expectOne(`${API}/estates/e1/debtors/balances`).flush(balances);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.balances()).toHaveLength(2);
      expect(h.el.textContent).toContain('Ana Al Día');
      expect(h.el.textContent).toContain('Al día');
    });

    it('un anticipo sin aplicar se avisa aparte del saldo — nunca se resta', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.setViewMode('all');
      const balances: NeighbourBalance[] = [
        { propertyId: 'p1', property: { ref: '1A', staircase: null, floor: null, door: null }, titular: 'Juan Moroso', email: null, phone: null, balance: 210, advance: 50, isUpToDate: false, debtorId: 'd1', monthsOverdue: 3, step: 'Sin gestionar', lastContact: null, reminderL1: false, reminderL2: false, reminderBf: false },
      ];
      h.http.expectOne(`${API}/estates/e1/debtors/balances`).flush(balances);
      await settle();
      h.fixture.detectChanges();

      // El saldo mostrado sigue siendo el bruto (210€), no 160€.
      expect(h.el.textContent).toContain('210');
      const hint = h.el.querySelector('.advance-hint');
      expect(hint?.textContent).toContain('50');
      expect(hint?.textContent).toContain('sin aplicar');
    });

    it('no vuelve a pedir el saldo si ya se cargó una vez', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.setViewMode('all');
      h.http.expectOne(`${API}/estates/e1/debtors/balances`).flush([]);
      await settle();

      h.component.setViewMode('debt');
      h.component.setViewMode('all');
      h.http.expectNone(`${API}/estates/e1/debtors/balances`);
    });
  });

  describe('Exportar Excel', () => {
    it('descarga el .xlsx real de la finca', async () => {
      flushInitialLoad([makeDebtor({ id: 'd1' })]);
      await settle();
      h.fixture.detectChanges();

      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
      try {
        const promise = h.component.exportExcel();
        const req = h.http.expectOne(`${API}/estates/e1/debtors/balances.xlsx`);
        req.flush(new Blob(['fake-xlsx']));
        await promise;

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
    });
  });
});
