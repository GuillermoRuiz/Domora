import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { RecibosTabComponent } from './recibos-tab.component';
import type { AccountingEstate, AccountingReceipt, RemesaHistoryItem, OwnerProperty } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<AccountingReceipt> = {}): AccountingReceipt {
  return {
    id: 'r1', no: 'REC-001', periodKey: '2026-03', period: 'Marzo 2026', owner: 'Ana García', unit: 'Piso 3A',
    amount: 100, iban: 'ES1234', mandate: 'M1', concept: 'Cuota ordinaria', kind: 'Cuota ordinaria',
    status: 'Pendiente', date: '2026-03-01', method: 'Domiciliación', manual: false,
    ...overrides,
  };
}

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return { id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado', staircase: '1', floor: '2', door: 'A' } as OwnerProperty;
}

function makeRawRemesa(item: Partial<RemesaHistoryItem> & { id: string }): any {
  return {
    id: item.id, period: { label: item.period ?? '', periodKey: item.periodKey ?? '' }, scheme: item.scheme ?? 'CORE',
    linesCount: item.count ?? 0, totalAmount: item.amount ?? 0, presentedAt: item.presented ?? '2026-03-01',
    chargeDate: item.charge ?? '2026-03-05', status: item.status ?? 'Presentada', charged: item.charged ?? 0,
    returned: item.returned ?? 0, pending: item.pending ?? 0, returnedAmount: item.returnedAmount ?? 0,
  };
}

function history(overrides: Record<string, unknown> = {}): any {
  return {
    receiptId: 'r1', no: 'REC-001', amount: 100, outstanding: 100, status: 'Pendiente',
    movements: [{ date: '2026-03-01', entryNumber: 1, fiscalYear: 2026, sourceType: 'receipt_issue', concept: 'Emisión', debit: 100, credit: 0, balance: 100, method: null, returnCode: null, returnReason: null, collectionId: null, collectionActive: false, fromRemesa: false }],
    ...overrides,
  };
}

describe('RecibosTabComponent', () => {
  let h: ComponentHarness<RecibosTabComponent>;

  beforeEach(() => {
    h = setupComponent(RecibosTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function flushInitialLoad(opts: { periods?: { key: string; label: string }[]; remesas?: any[]; properties?: OwnerProperty[]; receipts?: AccountingReceipt[] } = {}): Promise<void> {
    h.fixture.detectChanges();
    const periods = opts.periods ?? [{ key: '2026-03', label: 'Marzo 2026' }];
    h.http.expectOne((r) => r.url === `${API}/estates/e1/accounting/periods`).flush(periods.map((p) => ({ periodKey: p.key, label: p.label })));
    h.http.expectOne((r) => r.url === `${API}/estates/e1/remesas`).flush(opts.remesas ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/properties`).flush(opts.properties ?? [makeProperty()]);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush(opts.receipts ?? []);
    await settle();
    h.fixture.detectChanges();
  }

  it('carga periodos/remesas/propiedades/recibos al montar y preselecciona el primer periodo', async () => {
    await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1' })] });

    expect(h.component.selectedPeriodKey()).toBe('2026-03');
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  describe('KPIs por periodo (regresión del bug de mapReceipt: amount como string sumaba mal)', () => {
    it('total/cobrado/pendiente/devuelto se calculan sumando números, no concatenando strings', async () => {
      await flushInitialLoad({
        receipts: [
          makeReceipt({ id: 'r1', amount: 100, status: 'Pagada' }),
          makeReceipt({ id: 'r2', amount: 200, status: 'Pagada' }),
          makeReceipt({ id: 'r3', amount: 50, status: 'Pendiente' }),
          makeReceipt({ id: 'r4', amount: 30, status: 'Devuelto' }),
        ],
      });

      const kpis = h.component.kpis();
      expect(kpis.total).toBe(380);
      expect(kpis.cobrado).toBe(300); // si concatenara strings sería "100200" en vez de 300
      expect(kpis.pendiente).toBe(50);
      expect(kpis.devuelto).toBe(30);
    });
  });

  describe('filtros', () => {
    it('la búsqueda filtra por propietario, unidad o número de recibo', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', owner: 'Ana García' }), makeReceipt({ id: 'r2', owner: 'Luis Pérez' })] });

      h.component.searchQuery.set('luis');
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('tbody tr')).toHaveLength(1);
    });

    it('el filtro de estado y de método se combinan', async () => {
      await flushInitialLoad({
        receipts: [
          makeReceipt({ id: 'r1', status: 'Pagada', method: 'Domiciliación' }),
          makeReceipt({ id: 'r2', status: 'Pagada', method: 'Transferencia' }),
          makeReceipt({ id: 'r3', status: 'Pendiente', method: 'Domiciliación' }),
        ],
      });

      h.component.statusFilter.set('Pagada');
      h.component.methodFilter.set('Domiciliación');
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('tbody tr')).toHaveLength(1);
    });

    it('"Todos los periodos" agrega recibos de todos los periodos y muestra la columna Periodo', async () => {
      await flushInitialLoad({
        periods: [{ key: '2026-03', label: 'Marzo' }, { key: '2026-04', label: 'Abril' }],
        receipts: [makeReceipt({ id: 'r1', periodKey: '2026-03' }), makeReceipt({ id: 'r2', periodKey: '2026-04' })],
      });
      expect(h.el.querySelectorAll('tbody tr')).toHaveLength(1); // solo marzo, el periodo preseleccionado

      h.component.selectedPeriodKey.set('all');
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(h.el.querySelector('thead th:nth-child(5)')?.textContent).toContain('Periodo');
    });
  });

  describe('cambiar el estado de un recibo', () => {
    it('marcar como cobrado actualiza el recibo, recarga la lista y refresca el detalle si estaba abierto', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', no: 'REC-001', status: 'Pendiente' })] });
      const receipt = h.component.filteredReceipts()[0];
      h.component.openDetail(receipt);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/receipts/r1/history`).flush(history());

      const promise = h.component.changeStatus(receipt, 'Pagada');
      const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ status: 'Pagada' });
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([makeReceipt({ id: 'r1', no: 'REC-001', status: 'Pagada' })]);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.selectedReceipt()?.status).toBe('Pagada');
      expect(h.el.querySelector('.toast')?.textContent).toContain('REC-001');
    });
  });

  describe('editar un recibo', () => {
    it('un recibo Pendiente solo permite cambiar el método de cobro (sin campos de devolución)', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', status: 'Pendiente', method: 'Domiciliación' })] });
      h.component.openEditModal(h.component.filteredReceipts()[0]);
      h.fixture.detectChanges();

      expect(h.el.querySelector('input[maxlength="10"]')).toBeNull(); // sin campo de código de devolución

      h.component.editForm.method = 'Transferencia';
      const promise = h.component.submitEditReceipt();
      const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ method: 'Transferencia' });
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([makeReceipt({ id: 'r1', status: 'Pendiente', method: 'Transferencia' })]);
      await promise;

      expect(h.component.editingReceipt()).toBeNull();
    });

    it('un recibo Devuelto también manda returnCode/returnReason', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', status: 'Devuelto', method: 'Domiciliación', returnCode: 'MD01' })] });
      h.component.openEditModal(h.component.filteredReceipts()[0]);
      h.component.editForm.returnCode = 'AC04';
      h.component.editForm.returnReason = 'Cuenta cerrada';

      const promise = h.component.submitEditReceipt();
      const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ method: 'Domiciliacion', returnCode: 'AC04', returnReason: 'Cuenta cerrada' }); // PAY_METHOD_TO_API traduce al código sin acento del backend
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([makeReceipt({ id: 'r1', status: 'Devuelto' })]);
      await promise;
    });
  });

  describe('justificante de pago', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    it('"Ver justificante" en un recibo pagado descarga el fichero real, no un toast de "próximamente"', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', status: 'Pagada', proofFileName: 'justificante.pdf' } as Partial<AccountingReceipt>)] });

      const promise = h.component.downloadProof(h.component.filteredReceipts()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1/payment-proof/file`);
      req.flush(new Blob(['contenido']));
      await promise;

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });
  });

  describe('crear un recibo manual', () => {
    it('sin propiedad/concepto/importe/vencimiento, el botón queda deshabilitado', async () => {
      await flushInitialLoad();
      h.component.openManualModal();
      h.fixture.detectChanges();

      const createBtn = Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Crear recibo')) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(true);
    });

    it('con los campos completos, crea el recibo, lo antepone a la lista y recarga los periodos', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r-vieja', no: 'REC-000' })] });
      h.component.openManualModal();
      h.component.manualForm.propertyId = 'p1';
      h.component.manualForm.concept = 'Derrama ascensor';
      h.component.manualForm.amount = '150';
      h.component.manualForm.dueDate = '2026-04-15';
      h.fixture.detectChanges();

      const submitPromise = h.component.submitManualReceipt();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts` && r.method === 'POST');
      // El tipo viaja como valor del enum (decide la cuenta de ingreso).
      expect(req.request.body).toMatchObject({ propertyId: 'p1', concept: 'Derrama ascensor', amount: 150, kind: 'cuota_ordinaria' });
      req.flush(makeReceipt({ id: 'r-nueva', no: 'REC-002', manual: true }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/accounting/periods`).flush([{ periodKey: '2026-03', label: 'Marzo 2026' }]);
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showManualModal()).toBe(false);
      const nums = Array.from(h.el.querySelectorAll('.td--no')).map((n) => n.textContent?.trim().split('\n')[0]);
      expect(nums?.[0]).toContain('REC-002'); // se antepone, no se añade al final
    });
  });

  describe('anular un recibo (contraasiento de su emisión)', () => {
    const actionLabels = (r: AccountingReceipt) => h.component.contextActions(r).flat().map((a) => a.label);

    it('se ofrece solo si no tiene nada cobrado; un anulado solo se consulta', async () => {
      await flushInitialLoad();
      expect(actionLabels(makeReceipt({ status: 'Pendiente', outstanding: 100 }))).toContain('Anular recibo');
      expect(actionLabels(makeReceipt({ status: 'Devuelto', outstanding: 100 }))).toContain('Anular recibo');
      expect(actionLabels(makeReceipt({ status: 'Pagada', outstanding: 0 }))).not.toContain('Anular recibo');
      expect(actionLabels(makeReceipt({ status: 'Parcial', outstanding: 40 }))).not.toContain('Anular recibo');
      const cancelled = actionLabels(makeReceipt({ status: 'Anulado', outstanding: 0 }));
      expect(cancelled).not.toContain('Editar');
      expect(cancelled).not.toContain('Anular recibo');
    });

    it('exige un motivo y lo manda a /cancel; después recarga la lista', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', no: 'REC-001' })] });
      h.component.openCancel(makeReceipt({ id: 'r1', no: 'REC-001' }));
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Anular el recibo REC-001');

      await h.component.confirmCancel();
      expect(h.component.cancelError()).toContain('motivo');
      h.http.expectNone((r) => r.url.endsWith('/cancel'));

      h.component.cancelReason.set('Emitido a la propiedad equivocada');
      const confirm = h.component.confirmCancel();
      const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1/cancel` && r.method === 'POST');
      expect(req.request.body).toEqual({ reason: 'Emitido a la propiedad equivocada' });
      req.flush({ id: 'r1', no: 'REC-001', amount: '100', outstanding: '0', kind: 'cuota_ordinaria', status: 'Anulado', date: '2026-03-01' });
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([{ ...makeReceipt({ id: 'r1' }), status: 'Anulado' }]);
      await confirm;
      h.fixture.detectChanges();

      expect(h.component.cancelling()).toBeNull();
      expect(h.el.querySelector('.toast')?.textContent).toContain('REC-001 anulado');
    });

    it('si la contabilidad lo rechaza (en remesa, con cobros…), muestra el motivo', async () => {
      await flushInitialLoad();
      h.component.openCancel(makeReceipt({ id: 'r1' }));
      h.component.cancelReason.set('Error');
      const confirm = h.component.confirmCancel();
      h.http
        .expectOne((r) => r.url.endsWith('/receipts/r1/cancel'))
        .flush({ message: 'El recibo REC-001 está en una remesa enviada al banco: espera al cobro o a la devolución.' }, { status: 409, statusText: 'Conflict' });
      await confirm;
      expect(h.component.cancelError()).toContain('remesa enviada al banco');
    });
  });

  describe('estados nuevos', () => {
    it('los anulados no cuentan en los KPIs y lo pendiente sale de lo que falta por cobrar', async () => {
      await flushInitialLoad({
        receipts: [
          makeReceipt({ id: 'r1', amount: 100, outstanding: 40, status: 'Parcial' }),
          makeReceipt({ id: 'r2', amount: 80, outstanding: 0, status: 'Anulado' }),
          makeReceipt({ id: 'r3', amount: 50, outstanding: 0, status: 'Pagada' }),
        ],
      });
      const kpis = h.component.kpis();
      expect(kpis.total).toBe(150);
      expect(kpis.cobrado).toBe(110);
      expect(kpis.pendiente).toBe(40);
      expect(h.component.countAnulado()).toBe(1);
      expect(h.component.countPendiente()).toBe(1); // el parcial cuenta como pendiente
    });

    it('si cobrar falla en la contabilidad, se muestra el motivo en vez de fallar en silencio', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1' })] });
      const change = h.component.changeStatus(makeReceipt({ id: 'r1' }), 'Pagada');
      h.http
        .expectOne((r) => r.url === `${API}/receipts/r1` && r.method === 'PATCH')
        .flush({ message: 'El ejercicio 2026 está cerrado: no admite asientos.' }, { status: 409, statusText: 'Conflict' });
      await change;
      h.fixture.detectChanges();
      expect(h.el.querySelector('.toast')?.textContent).toContain('está cerrado');
    });
  });

  describe('descarga del fichero SEPA (nunca genera una remesa nueva)', () => {
    it('sin remesa presentada para el periodo, avisa honestamente y no crea nada', async () => {
      await flushInitialLoad({ remesas: [] });

      await h.component.downloadSepaFile();
      h.fixture.detectChanges();

      h.http.expectNone((r) => r.method === 'POST' && r.url.includes('/remesas'));
      expect(h.component.toastMessage()).toContain('Usa "Nueva remesa"');
    });

    it('con una remesa ya presentada, descarga el mismo XML sin regenerar nada', async () => {
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
      try {
        await flushInitialLoad({ remesas: [makeRawRemesa({ id: 'R1', periodKey: '2026-03' })] });

        const promise = h.component.downloadSepaFile();
        const req = h.http.expectOne((r) => r.url === `${API}/remesas/R1/file`);
        req.flush('<xml>contenido</xml>');
        await promise;

        expect(URL.createObjectURL).toHaveBeenCalled();
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    });
  });
  describe('cobros contabilizados', () => {
    const actionLabels = (r: AccountingReceipt) => h.component.contextActions(r).flat().map((a) => a.label);
    const buttonIn = (selector: string, text: string) =>
      Array.from(h.el.querySelectorAll<HTMLButtonElement>(`${selector} button`)).find((b) => b.textContent?.trim().includes(text))!;

    it('se ofrece registrar cobro en lo que se debe: pendiente, a medias o devuelto', async () => {
      await flushInitialLoad();
      expect(actionLabels(makeReceipt({ status: 'Pendiente' }))).toContain('Registrar cobro');
      expect(actionLabels(makeReceipt({ status: 'Parcial', outstanding: 40 }))).toContain('Registrar cobro');
      expect(actionLabels(makeReceipt({ status: 'Devuelto' }))).toContain('Registrar cobro');
      expect(actionLabels(makeReceipt({ status: 'Pagada', outstanding: 0 }))).not.toContain('Registrar cobro');
      expect(actionLabels(makeReceipt({ status: 'Anulado', outstanding: 0 }))).not.toContain('Registrar cobro');
    });

    it('registrar un cobro parcial manda el importe y el recibo, y recarga la lista', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', propertyId: 'p1', outstanding: 100 })] });
      h.component.openCollect(h.component.filteredReceipts()[0]);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([{ id: 'b1', alias: 'Principal', isDefault: true, closedAt: null, balance: '0' }]);
      h.http.expectOne(`${API}/estates/e1/property-accounts/p1`).flush({ propertyId: 'p1', pending: 100, advance: 0, balance: 100, openReceipts: [] });
      await settle();
      h.fixture.detectChanges();
      await h.fixture.whenStable();
      expect(h.el.textContent).toContain('Registrar cobro del recibo REC-001');

      const input = h.el.querySelector<HTMLInputElement>('#cobro-amount')!;
      input.value = '40,00';
      input.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      buttonIn('app-registrar-cobro .modal__footer', 'Registrar cobro').click();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/collections` && r.method === 'POST');
      expect(req.request.body).toEqual({
        propertyId: 'p1', date: expect.any(String), amount: 40, method: 'Transferencia', bankAccountId: 'b1', receiptIds: ['r1'],
      });
      req.flush({});
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([makeReceipt({ id: 'r1', status: 'Parcial', outstanding: 60 })]);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.collecting()).toBeNull();
      expect(h.component.toastMessage()).toContain('Cobro registrado');
    });

    it('el detalle muestra el historial y deshacer un cobro pide motivo', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', status: 'Pagada', outstanding: 0 })] });
      h.component.openDetail(h.component.filteredReceipts()[0]);
      h.fixture.detectChanges();
      const paid = { date: '2026-03-10', entryNumber: 2, fiscalYear: 2026, sourceType: 'collection', concept: 'Cobro', debit: 0, credit: 100, balance: 0, method: 'Transferencia', returnCode: null, returnReason: null, collectionId: 'c1', collectionActive: true, fromRemesa: false };
      h.http.expectOne(`${API}/receipts/r1/history`).flush(history({ outstanding: 0, status: 'Pagada', movements: [history().movements[0], paid] }));
      await settle();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Historial de cobros');
      expect(h.el.textContent).toContain('Devuelto por el banco');

      buttonIn('app-historial-cobros', 'Deshacer').click();
      h.fixture.detectChanges();
      await h.fixture.whenStable();
      buttonIn('app-historial-cobros .modal__footer', 'Deshacer cobro').click();
      await settle();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Indica el motivo');
      h.http.expectNone(`${API}/collections/c1/undo`);

      const reason = h.el.querySelector<HTMLInputElement>('#undo-reason')!;
      reason.value = 'Registrado dos veces';
      reason.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      buttonIn('app-historial-cobros .modal__footer', 'Deshacer cobro').click();
      const req = h.http.expectOne(`${API}/collections/c1/undo`);
      expect(req.request.body).toEqual({ reason: 'Registrado dos veces' });
      req.flush({});
      await settle();
      h.http.expectOne(`${API}/receipts/r1/history`).flush(history());
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/receipts`).flush([makeReceipt({ id: 'r1', status: 'Pendiente', outstanding: 100 })]);
      await settle();
      expect(h.component.toastMessage()).toContain('Cobro deshecho');
    });

    it('un cobro de remesa no se deshace desde el recibo', async () => {
      await flushInitialLoad({ receipts: [makeReceipt({ id: 'r1', status: 'Pagada', outstanding: 0 })] });
      h.component.openDetail(h.component.filteredReceipts()[0]);
      h.fixture.detectChanges();
      const viaRemesa = { date: '2026-03-06', entryNumber: 3, fiscalYear: 2026, sourceType: 'remesa_collection', concept: 'Remesa', debit: 0, credit: 100, balance: 0, method: 'Domiciliación', returnCode: null, returnReason: null, collectionId: 'c9', collectionActive: true, fromRemesa: true };
      h.http.expectOne(`${API}/receipts/r1/history`).flush(history({ movements: [history().movements[0], viaRemesa] }));
      await settle();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Se devuelve desde la remesa');
      const buttons = Array.from(h.el.querySelectorAll('app-historial-cobros button')).map((b) => b.textContent?.trim());
      expect(buttons).not.toContain('Deshacer');
    });
  });
});
