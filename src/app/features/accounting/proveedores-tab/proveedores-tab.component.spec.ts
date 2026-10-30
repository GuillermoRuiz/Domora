import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { ProveedoresTabComponent } from './proveedores-tab.component';
import type { Supplier, SupplierInvoice, SupplierContract, SupplierDocument, SupplierPerformance } from '../../../core/models';
import type { AiInvoiceDocument } from '../../../core/ai.service';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup1', administratorId: 'a1', estateId: 'e1', name: 'Ascensores XYZ', category: 'Mantenimiento',
    status: 'Activo', hasExpiringSoon: false,
    lastInvoice: '2026-01-01', lastAmount: 150, ytdSpend: 1200, pendingInvoices: 0,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<SupplierInvoice> = {}): SupplierInvoice {
  return {
    id: 'inv1', supplierId: 'sup1', supplierName: 'Ascensores XYZ', number: 'F-001', concept: 'Revisión mensual',
    issueDate: '2026-01-01', receivedDate: '2026-01-01', dueDate: null,
    baseAmount: 123.97, vatRatePct: 21, vatAmount: 26.03, withholdingRatePct: 0, withholdingAmount: 0, withholdingKey: null,
    total: 150, payable: 150, payableAccount: '400', status: 'Pagada', outstanding: 0, cancelReason: null, lines: [],
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'pay1', supplierId: 'sup1', supplierName: 'Ascensores XYZ', date: '2026-02-01', amount: 150, method: 'Transferencia',
    bankAccountAlias: 'Principal', notes: null, status: 'Vigente', undoReason: null,
    invoices: [{ invoiceId: 'inv1', number: 'F-001', amount: 150 }],
    ...overrides,
  };
}

function makeContract(overrides: Partial<SupplierContract> = {}): SupplierContract {
  return {
    id: 'con1', supplierId: 'sup1', estateId: 'e1', serviceType: 'Mantenimiento ascensor',
    startDate: '2026-01-01', endDate: null, renewalType: 'tacita', reviewFrequency: null,
    cancelledAt: null, cancelledReason: null, notes: null, status: 'Activo',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<SupplierDocument> = {}): SupplierDocument {
  return {
    id: 'doc1', supplierId: 'sup1', contractId: null, documentType: 'Seguro',
    title: 'Póliza RC', fileName: 'poliza.pdf', mimeType: 'application/pdf',
    expiresAt: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePerformance(overrides: Partial<SupplierPerformance> = {}): SupplierPerformance {
  return { totalIssuesAssigned: 0, resolvedIssues: 0, openIssues: 0, ...overrides };
}

describe('ProveedoresTabComponent', () => {
  let h: ComponentHarness<ProveedoresTabComponent>;

  beforeEach(() => {
    h = setupComponent(ProveedoresTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(suppliers: Supplier[], invoiceDocs: AiInvoiceDocument[] = []): void {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush(suppliers);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents` && r.method === 'GET')
      .flush({ data: invoiceDocs, total: invoiceDocs.length, page: 1, pageSize: 30 });
  }

  /** Al abrir el detalle se piden en paralelo facturas, contratos, documentos, rendimiento, pagos y mayor. */
  async function openDetail(supplierId: string, opts: {
    invoices?: SupplierInvoice[]; contracts?: SupplierContract[]; documents?: SupplierDocument[]; performance?: SupplierPerformance;
    payments?: any[]; ledger?: any;
  } = {}): Promise<void> {
    (h.el.querySelector('tbody tr') as HTMLElement).click();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/invoices`).flush(opts.invoices ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/contracts`).flush(opts.contracts ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/documents`).flush(opts.documents ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/performance`).flush(opts.performance ?? makePerformance());
    h.http.expectOne((r) => r.url === `${API}/estates/e1/supplier-payments` && r.params.get('supplierId') === supplierId).flush(opts.payments ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/ledger`).flush(opts.ledger ?? { supplierId, balance: 0, movements: [] });
    await settle();
    h.fixture.detectChanges();
  }

  /** Tras pagar, anular o deshacer: lista de proveedores y, del abierto, facturas, pagos y mayor. */
  async function flushMoneyReload(supplierId: string, opts: { invoices?: SupplierInvoice[]; payments?: any[]; ledger?: any } = {}): Promise<void> {
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([makeSupplier({ id: supplierId })]);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/invoices`).flush(opts.invoices ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/supplier-payments`).flush(opts.payments ?? []);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/${supplierId}/ledger`).flush(opts.ledger ?? { supplierId, balance: 0, movements: [] });
    await settle();
    h.fixture.detectChanges();
  }

  it('carga los proveedores al montar y refleja los KPIs', async () => {
    flushInitialLoad([
      makeSupplier({ id: 's1', category: 'Mantenimiento', ytdSpend: 1000, pendingInvoices: 2 }),
      makeSupplier({ id: 's2', category: 'Limpieza', ytdSpend: 500, pendingInvoices: 0 }),
    ]);
    await settle();
    h.fixture.detectChanges();

    const kpis = h.el.querySelectorAll('.kpi-card__value');
    expect(kpis[0].textContent?.trim()).toBe('2'); // proveedores activos
    // Nota: en este runtime de test, Number.toLocaleString('es-ES') con
    // maximumFractionDigits:0 no aplica separador de miles (useGrouping
    // 'auto' se resuelve distinto que en un navegador real) — no es un bug
    // de la app, solo una particularidad de Node/ICU en Vitest.
    expect(kpis[1].textContent?.trim()).toBe('1500 €'); // gasto YTD
    expect(kpis[2].textContent?.trim()).toBe('2'); // facturas pendientes
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('la fila de un proveedor con vencimiento próximo muestra el badge "Vence pronto"', async () => {
    flushInitialLoad([makeSupplier({ id: 's1', hasExpiringSoon: true })]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Vence pronto');
  });

  it('el detalle de un proveedor carga sus facturas, contratos, documentos y rendimiento', async () => {
    flushInitialLoad([makeSupplier({ id: 'sup1', name: 'Ascensores XYZ' })]);
    await settle();
    h.fixture.detectChanges();

    await openDetail('sup1', {
      invoices: [makeInvoice()],
      contracts: [makeContract()],
      documents: [makeDocument()],
      performance: makePerformance({ totalIssuesAssigned: 3, resolvedIssues: 2, openIssues: 1 }),
    });

    expect(h.el.querySelector('.drawer')).not.toBeNull();
    expect(h.el.textContent).toContain('Revisión mensual');
    expect(h.el.textContent).toContain('Mantenimiento ascensor');
    expect(h.el.textContent).toContain('Póliza RC');
    expect(h.el.textContent).toContain('3'); // incidencias asignadas
  });

  describe('editar y dar de baja un proveedor', () => {
    it('editar precarga el formulario y envía un PATCH', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1', name: 'Ascensores XYZ', category: 'Mantenimiento', iban: 'ES1234' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');

      (Array.from(h.el.querySelectorAll('.icon-btn')).find((b) => b.getAttribute('title') === 'Editar') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.npName()).toBe('Ascensores XYZ');
      expect(h.component.npIban()).toBe('ES1234');

      h.component.npName.set('Ascensores XYZ SL');
      const submitPromise = h.component.submitNuevoProveedor();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1` && r.method === 'PATCH');
      expect(req.request.body).toMatchObject({ name: 'Ascensores XYZ SL' });
      req.flush(makeSupplier({ id: 'sup1', name: 'Ascensores XYZ SL' }));
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoProveedor()).toBe(false);
    });

    it('dar de baja pide confirmación y envía status: Baja', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad([makeSupplier({ id: 'sup1', status: 'Activo' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');

      (Array.from(h.el.querySelectorAll('.icon-btn')).find((b) => b.getAttribute('title') === 'Dar de baja') as HTMLElement).click();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ status: 'Baja' });
      req.flush(makeSupplier({ id: 'sup1', status: 'Baja' }));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('dado de baja');
    });
  });

  describe('modal "Nuevo proveedor"', () => {
    it('sin nombre ni categoría, no envía nada y marca los errores', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo proveedor')) as HTMLElement).click();
      h.fixture.detectChanges();
      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Añadir proveedor')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.npErrors()).toEqual({ name: true, category: true });
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('con los campos completos (incluido IBAN), crea el proveedor y lo antepone a la lista', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup-vieja', name: 'Vieja' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openNuevoProveedor();
      h.component.npName.set('Jardines SL');
      h.component.npCategory.set('Mantenimiento');
      h.component.npIban.set('ES9820385778983000760236');
      h.fixture.detectChanges();

      const submitPromise = h.component.submitNuevoProveedor();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ name: 'Jardines SL', category: 'Mantenimiento', iban: 'ES9820385778983000760236' });
      req.flush(makeSupplier({ id: 'sup-nuevo', name: 'Jardines SL', category: 'Mantenimiento' }));
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoProveedor()).toBe(false);
      const names = Array.from(h.el.querySelectorAll('.supplier-name span')).map((n) => n.textContent);
      expect(names).toEqual(['Jardines SL', 'Vieja']);
    });

    it('suministros y seguros se proponen fuera del 347; si se cambia a mano, la categoría ya no lo pisa', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      h.component.openNuevoProveedor();
      h.component.npName.set('Eléctrica');
      h.component.onCategoryChange('Suministros');
      expect(h.component.npExcluded347()).toBe(true);
      h.component.onCategoryChange('Mantenimiento');
      expect(h.component.npExcluded347()).toBe(false);
      h.component.setExcluded347(true);
      h.component.onCategoryChange('Limpieza');
      expect(h.component.npExcluded347()).toBe(true);

      const submit = h.component.submitNuevoProveedor();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ name: 'Eléctrica', category: 'Limpieza', excludedFrom347: true });
      req.flush(makeSupplier({ id: 'sup-luz', name: 'Eléctrica' }));
      await submit;
    });
  });

  describe('facturas, pagos y mayor del proveedor', () => {
    it('el detalle muestra facturas con su estado, pagos y el mayor con lo que se le debe', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', {
        invoices: [makeInvoice({ status: 'Parcial', outstanding: 50, total: 150 })],
        payments: [makePayment({ amount: 100, invoices: [{ invoiceId: 'inv1', number: 'F-001', amount: 100 }] })],
        ledger: {
          supplierId: 'sup1', balance: 50,
          movements: [
            { date: '2026-01-01', entryNumber: 1, fiscalYear: 2026, sourceType: 'supplier_invoice', concept: 'x', accountCode: '400', invoiceNumber: 'F-001', debit: 0, credit: 150, balance: 150 },
            { date: '2026-02-01', entryNumber: 2, fiscalYear: 2026, sourceType: 'supplier_payment', concept: 'x', accountCode: '400', invoiceNumber: 'F-001', debit: 100, credit: 0, balance: 50 },
          ],
        },
      });
      expect(h.el.textContent).toContain('Factura F-001');
      expect(h.el.textContent).toContain('Quedan 50,00 €');
      expect(h.el.textContent).toContain('Mayor del proveedor');
      expect(h.el.textContent).toContain('Se le debe 50,00 €');
      expect(h.el.querySelector('[aria-label="Pagar la factura F-001"]')).not.toBeNull();
      // Con pagos no se puede anular.
      expect(h.el.querySelector('[aria-label="Anular la factura F-001"]')).toBeNull();
    });

    it('"Registrar factura" abre el formulario contable y, al guardar, recarga facturas, pagos y mayor', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');
      h.component.openRegistrarFactura('sup1');
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-registrar-factura')).not.toBeNull();
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([]);
      h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([]);
      await settle();

      const done = h.component.onFacturaClosed({ saved: true, supplierId: 'sup1' });
      await flushMoneyReload('sup1', { invoices: [makeInvoice({ status: 'Registrada', outstanding: 150 })] });
      await done;
      expect(h.component.showRegistrarFactura()).toBe(false);
      expect(h.component.supplierInvoices()[0].status).toBe('Registrada');
      expect(h.component.toastMessage()).toContain('contabilizada');
    });

    it('anular una factura sin pagos exige motivo y recarga', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { invoices: [makeInvoice({ status: 'Registrada', outstanding: 150 })] });

      (h.el.querySelector('[aria-label="Anular la factura F-001"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Anular la factura F-001');
      await h.component.confirmCancelInvoice();
      expect(h.component.cancelError()).toContain('motivo');

      h.component.cancelReason.set('Importe equivocado');
      const confirm = h.component.confirmCancelInvoice();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/invoices/inv1/cancel` && r.method === 'POST');
      expect(req.request.body).toEqual({ reason: 'Importe equivocado' });
      req.flush(makeInvoice({ status: 'Anulada', outstanding: 0 }));
      await settle();
      await flushMoneyReload('sup1', { invoices: [makeInvoice({ status: 'Anulada', outstanding: 0, cancelReason: 'Importe equivocado' })] });
      await confirm;
      expect(h.component.cancellingInvoice()).toBeNull();
      expect(h.component.toastMessage()).toContain('anulada');
    });

    it('pagar abre el diálogo con la factura elegida; al guardar recarga', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { invoices: [makeInvoice({ status: 'Registrada', outstanding: 150 })] });
      (h.el.querySelector('[aria-label="Pagar la factura F-001"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('app-pagar-proveedor')).not.toBeNull();
      expect(h.component.paying()).toEqual({ invoiceId: 'inv1' });
      h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([]);
      await settle();

      const done = h.component.onPayClosed({ saved: true, message: 'Pago de 150,00 € registrado' });
      await flushMoneyReload('sup1', { invoices: [makeInvoice()] , payments: [makePayment()] });
      await done;
      expect(h.component.paying()).toBeNull();
      expect(h.component.toastMessage()).toContain('Pago de 150,00 €');
    });

    it('deshacer un pago exige motivo y recarga', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { invoices: [makeInvoice()], payments: [makePayment()] });

      (h.el.querySelector('[aria-label="Deshacer el pago"]') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      await h.component.confirmUndoPayment();
      expect(h.component.undoError()).toContain('motivo');

      h.component.undoReason.set('Transferencia devuelta');
      const confirm = h.component.confirmUndoPayment();
      const req = h.http.expectOne((r) => r.url === `${API}/supplier-payments/pay1/undo` && r.method === 'POST');
      expect(req.request.body).toEqual({ reason: 'Transferencia devuelta' });
      req.flush({});
      await settle();
      await flushMoneyReload('sup1', { invoices: [makeInvoice({ status: 'Registrada', outstanding: 150 })], payments: [makePayment({ status: 'Deshecho', undoReason: 'Transferencia devuelta' })] });
      await confirm;
      expect(h.component.undoingPayment()).toBeNull();
      expect(h.el.textContent).toContain('Deshecho: Transferencia devuelta');
    });
  });

  describe('facturas subidas (PDF o imagen): un único flujo de alta', () => {
    const fields = {
      supplier_name: 'Ascensores XYZ S.L.', supplier_tax_id: 'B-12345678', invoice_number: 'F-77', invoice_date: '2026-03-01',
      due_date: null, description: 'Revisión', net_amount: '100.00', vat_amount: '21.00', total_amount: '121.00',
      withholding_amount: null, currency: 'EUR', payment_reference: null, needs_review: false,
    };
    const readDoc: AiInvoiceDocument = {
      id: 'd1', fileName: 'factura-77.pdf', status: 'needs_review', invoiceId: null, createdAt: '2026-03-02T10:00:00Z',
      extraction: { fields, warnings: ['required_fields_missing'], source: 'text' },
    };
    const unreadDoc: AiInvoiceDocument = { id: 'd2', fileName: 'escaneo.jpg', status: 'batched', invoiceId: null, extraction: null, createdAt: '2026-03-02T10:05:00Z' };

    it('lista las facturas subidas sin registrar, con aviso traducido y sin botón si aún no se han leído', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })], [readDoc, unreadDoc, { ...readDoc, id: 'd3', fileName: 'ya-registrada.pdf', invoiceId: 'inv1' }]);
      await settle();
      h.fixture.detectChanges();
      const text = h.el.textContent ?? '';
      expect(text).toContain('Facturas subidas por registrar (2)');
      expect(text).toContain('factura-77.pdf');
      expect(text).toContain('Faltan datos obligatorios');
      expect(text).toContain('Leyendo la factura');
      expect(text).not.toContain('ya-registrada.pdf');
    });

    it('subir un fichero lo envía al endpoint de facturas y recarga la lista', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      const file = new File(['%PDF-1.4'], 'nueva.pdf', { type: 'application/pdf' });
      const done = h.component.onInvoiceUpload({ target: { files: [file], value: 'x' } } as unknown as Event);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents` && r.method === 'POST');
      expect(req.request.body.get('file').name).toBe('nueva.pdf');
      req.flush({ id: 'd9', status: 'pending', duplicate: false });
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents` && r.method === 'GET')
        .flush({ data: [{ ...unreadDoc, id: 'd9', fileName: 'nueva.pdf' }], total: 1, page: 1, pageSize: 30 });
      await done;
      h.fixture.detectChanges();
      expect(h.component.pendingDocs().map((d) => d.id)).toEqual(['d9']);
      expect(h.component.toastMessage()).toContain('Factura subida');
    });

    it('"Revisar y registrar" abre el formulario con el proveedor detectado por NIF y, al guardar, vincula el original', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1', taxId: 'B12345678' }), makeSupplier({ id: 'sup2', name: 'Otro', taxId: 'A99999999' })], [readDoc]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');

      h.component.reviewInvoiceDoc(readDoc);
      h.fixture.detectChanges();
      expect(h.component.rfSupplierId()).toBe('sup1');
      expect(h.el.querySelector('app-registrar-factura')).not.toBeNull();
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([]);
      h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([]);
      await settle();
      h.fixture.detectChanges();
      expect(h.el.textContent).toContain('Datos leídos de «factura-77.pdf»');

      const done = h.component.onFacturaClosed({ saved: true, supplierId: 'sup1', invoiceId: 'inv9' });
      const link = h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents/d1/invoice-link`);
      expect(link.request.body).toEqual({ invoiceId: 'inv9' });
      link.flush({});
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/ai/invoices/documents` && r.method === 'GET')
        .flush({ data: [{ ...readDoc, invoiceId: 'inv9', status: 'linked' }], total: 1, page: 1, pageSize: 30 });
      await settle();
      await flushMoneyReload('sup1');
      await done;
      expect(h.component.pendingDocs()).toEqual([]);
      expect(h.component.reviewingDoc()).toBeNull();
    });

    it('cerrar el formulario sin guardar no vincula nada', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })], [readDoc]);
      await settle();
      h.component.reviewInvoiceDoc(readDoc);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([]);
      h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([]);
      await settle();
      await h.component.onFacturaClosed({ saved: false });
      expect(h.component.showRegistrarFactura()).toBe(false);
      expect(h.component.pendingDocs()).toHaveLength(1);
    });
  });

  describe('contratos', () => {
    it('crea un contrato nuevo desde el drawer', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');

      h.component.openContractModal();
      h.component.ctServiceType.set('Mantenimiento ascensor');
      h.component.ctStartDate.set('2026-01-01');
      h.component.ctCostAmount.set(123.45);
      h.component.ctCostFrequency.set('MONTHLY');
      h.fixture.detectChanges();

      const submitPromise = h.component.submitContract();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/contracts` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ serviceType: 'Mantenimiento ascensor', startDate: '2026-01-01' });
      expect(req.request.body).toMatchObject({ costAmount: 123.45, costFrequency: 'MONTHLY', currency: 'EUR' });
      req.flush(makeContract());
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([makeSupplier({ id: 'sup1' })]);
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showContractModal()).toBe(false);
      expect(h.el.textContent).toContain('Mantenimiento ascensor');
    });

    it('cancelar un contrato pide confirmación y llama al endpoint de cancelación', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { contracts: [makeContract({ id: 'con1', status: 'Activo' })] });

      const promise = h.component.cancelContract(h.component.contracts()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/contracts/con1/cancel` && r.method === 'POST');
      req.flush(makeContract({ id: 'con1', status: 'Cancelado' }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([makeSupplier({ id: 'sup1' })]);
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('cancelado');
    });
  });

  describe('documentos', () => {
    it('sube un documento con fichero y lo antepone a la lista', async () => {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1');

      h.component.openDocumentModal();
      h.component.docTitle.set('Póliza RC');
      h.component.docFile.set(new File(['x'], 'poliza.pdf'));
      h.fixture.detectChanges();

      const submitPromise = h.component.submitDocument();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/documents` && r.method === 'POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush(makeDocument());
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([makeSupplier({ id: 'sup1' })]);
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showDocumentModal()).toBe(false);
      expect(h.el.textContent).toContain('Póliza RC');
    });

    it('eliminar un documento pide confirmación y lo quita de la lista', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { documents: [makeDocument({ id: 'doc1' })] });

      const promise = h.component.deleteDocument(h.component.documents()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/documents/doc1` && r.method === 'DELETE');
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers`).flush([makeSupplier({ id: 'sup1' })]);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.documents()).toHaveLength(0);
    });
  });

  describe('adjuntar y descargar el fichero de una factura', () => {
    async function openDetailWithInvoice(invoice: SupplierInvoice) {
      flushInitialLoad([makeSupplier({ id: 'sup1' })]);
      await settle();
      h.fixture.detectChanges();
      await openDetail('sup1', { invoices: [invoice] });
    }

    it('adjuntar un fichero a una factura sin adjunto la actualiza con el fileName devuelto', async () => {
      await openDetailWithInvoice(makeInvoice({ id: 'inv1', fileName: null }));

      // triggerAttach() fija qué factura recibe el adjunto y dispara el <input type="file"> oculto.
      const fileInput = h.el.querySelector('input[type="file"]') as HTMLInputElement;
      h.component.triggerAttach('inv1', fileInput);

      const file = new File(['x'], 'factura.pdf');
      const promise = h.component.onInvoiceFileChange({ target: { files: [file] } } as unknown as Event);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/invoices/inv1/file` && r.method === 'POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush(makeInvoice({ id: 'inv1', fileName: 'factura.pdf' }));
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelector('[title="Descargar adjunto"]')).not.toBeNull();
    });

    it('descargar el adjunto pide el fichero y limpia el object URL', async () => {
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
      try {
        await openDetailWithInvoice(makeInvoice({ id: 'inv1', fileName: 'factura.pdf' }));

        const promise = h.component.downloadInvoiceFile(h.component.supplierInvoices()[0]);
        const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/suppliers/sup1/invoices/inv1/file`);
        req.flush(new Blob(['contenido']));
        await promise;

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    });
  });
});
