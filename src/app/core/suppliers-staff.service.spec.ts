import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { SuppliersStaffService } from './suppliers-staff.service';

describe('SuppliersStaffService', () => {
  let h: ApiServiceHarness<SuppliersStaffService>;

  beforeEach(() => {
    h = setupApiService(SuppliersStaffService);
  });

  afterEach(() => h.http.verify());

  describe('Panel de Proveedores y visitas', () => {
    const visit = { id: 'v1', supplierId: 's1', purpose: 'Revisión', status: 'planificada' };

    it('getSuppliersOverview pide el resumen de la finca', async () => {
      const promise = h.service.getSuppliersOverview('e1');
      const overview = { kpis: { totalSuppliers: 1, activeContracts: 1, expiringContracts: 0, openIssues: 0 }, items: [], recentInterventions: [] };
      h.http.expectOne(`${API}/estates/e1/suppliers/overview`).flush(overview);
      expect(await promise).toEqual(overview);
    });

    it('listSupplierVisits pide las visitas del proveedor', async () => {
      const promise = h.service.listSupplierVisits('e1', 's1');
      h.http.expectOne(`${API}/estates/e1/suppliers/s1/visits`).flush([visit]);
      expect(await promise).toEqual([visit]);
    });

    it('createSupplierVisit envía los datos de la visita tal cual', async () => {
      const input = { scheduledAt: '2026-11-03T09:00:00.000Z', purpose: 'Revisión', assetId: 'a1' };
      const promise = h.service.createSupplierVisit('e1', 's1', input);
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/visits`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(input);
      req.flush(visit);
      await promise;
    });

    it('updateSupplierVisit hace PATCH y permite null para quitar un vínculo', async () => {
      const promise = h.service.updateSupplierVisit('e1', 's1', 'v1', { assetId: null, purpose: 'Otra' });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/visits/v1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ assetId: null, purpose: 'Otra' });
      req.flush(visit);
      await promise;
    });

    it('completar y cancelar envían las notas solo si las hay', async () => {
      const done = h.service.completeSupplierVisit('e1', 's1', 'v1', 'Todo bien');
      const doneReq = h.http.expectOne(`${API}/estates/e1/suppliers/s1/visits/v1/complete`);
      expect(doneReq.request.method).toBe('POST');
      expect(doneReq.request.body).toEqual({ notes: 'Todo bien' });
      doneReq.flush(visit);
      await done;

      const cancelled = h.service.cancelSupplierVisit('e1', 's1', 'v1');
      const cancelReq = h.http.expectOne(`${API}/estates/e1/suppliers/s1/visits/v1/cancel`);
      expect(cancelReq.request.body).toEqual({});
      cancelReq.flush(visit);
      await cancelled;
    });
  });

  describe('Suppliers', () => {
    it('listSuppliers castea los numéricos y normaliza lastInvoice', async () => {
      const promise = h.service.listSuppliers('e1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers`);
      req.flush([{ id: 's1', administratorId: 'a1', estateId: 'e1', name: 'Fontanería X', category: 'Fontanería', lastInvoice: '2026-01-01T00:00:00.000Z', lastAmount: '150', ytdSpend: '900', pendingInvoices: '2' }]);
      const [s] = await promise;
      expect(s.lastInvoice).toBe('2026-01-01');
      expect(s.lastAmount).toBe(150);
      expect(s.pendingInvoices).toBe(2);
    });

    it('sin factura previa, lastInvoice queda vacío y los importes en 0', async () => {
      const promise = h.service.listSuppliers('e1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers`);
      req.flush([{ id: 's1', administratorId: 'a1', estateId: 'e1', name: 'x', category: 'x', lastInvoice: null }]);
      const [s] = await promise;
      expect(s.lastInvoice).toBe('');
      expect(s.lastAmount).toBe(0);
      expect(s.pendingInvoices).toBe(0);
    });

    it('createSupplier arranca en cero (sin histórico todavía) independientemente de lo que devuelva el POST', async () => {
      const promise = h.service.createSupplier('e1', { name: 'Nuevo', category: 'Jardinería' });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 's2', administratorId: 'a1', estateId: 'e1', name: 'Nuevo', category: 'Jardinería' });
      const s = await promise;
      expect(s.lastInvoice).toBe('');
      expect(s.lastAmount).toBe(0);
      expect(s.ytdSpend).toBe(0);
      expect(s.pendingInvoices).toBe(0);
    });

    const rawInvoice = (overrides: Record<string, unknown> = {}) => ({
      id: 'i1', supplierId: 's1', supplierName: 'Arquitectos', number: 'F-1', concept: 'x',
      issueDate: '2026-01-10T00:00:00.000Z', receivedDate: '2026-01-12T00:00:00.000Z', dueDate: null,
      baseAmount: '1000', vatRatePct: '21', vatAmount: '210', withholdingRatePct: '15', withholdingAmount: '150',
      withholdingKey: 'G_profesional', total: '1210', payable: '1060', payableAccount: '400', status: 'Registrada', outstanding: '1060',
      lines: [{ lineNo: 1, accountId: 'a623', accountCode: '623', accountName: 'Profesionales', baseAmount: '1000', amount: '1210' }],
      ...overrides,
    });

    it('listSupplierInvoices castea importes y normaliza fechas', async () => {
      const promise = h.service.listSupplierInvoices('e1', 's1');
      h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices`).flush([rawInvoice()]);
      const [inv] = await promise;
      expect(inv).toMatchObject({ issueDate: '2026-01-10', receivedDate: '2026-01-12', total: 1210, payable: 1060, outstanding: 1060, withholdingAmount: 150 });
      expect(inv.lines[0]).toMatchObject({ baseAmount: 1000, amount: 1210 });
    });

    it('createSupplierInvoice manda base, IVA, retención y líneas', async () => {
      const payload = {
        number: 'F-1', concept: 'x', issueDate: '2026-01-10', vatRatePct: 21, withholdingRatePct: 15,
        withholdingKey: 'G_profesional' as const, lines: [{ accountId: 'a623', baseAmount: 1000 }],
      };
      const promise = h.service.createSupplierInvoice('e1', 's1', payload);
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices`);
      expect(req.request.body).toEqual(payload);
      req.flush(rawInvoice());
      expect((await promise).payable).toBe(1060);
    });

    it('cancelar, pendientes de la finca, pagar, pagos, deshacer y mayor', async () => {
      const cancel = h.service.cancelSupplierInvoice('e1', 's1', 'i1', 'Error');
      const c = h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices/i1/cancel`);
      expect(c.request.body).toEqual({ reason: 'Error' });
      c.flush(rawInvoice({ status: 'Anulada', outstanding: '0' }));
      expect((await cancel).status).toBe('Anulada');

      const pending = h.service.listEstateSupplierInvoices('e1');
      h.http.expectOne((r) => r.url === `${API}/estates/e1/supplier-invoices` && !r.params.has('all')).flush([rawInvoice()]);
      expect(await pending).toHaveLength(1);

      const pay = h.service.paySupplier('e1', { supplierId: 's1', date: '2026-02-01', amount: 1060, method: 'Domiciliación', invoiceIds: ['i1'] });
      const p = h.http.expectOne(`${API}/estates/e1/supplier-payments`);
      expect(p.request.body).toEqual({ supplierId: 's1', date: '2026-02-01', amount: 1060, method: 'Domiciliacion', invoiceIds: ['i1'] });
      p.flush({});
      await pay;

      const list = h.service.listSupplierPayments('e1', 's1');
      h.http.expectOne((r) => r.url === `${API}/estates/e1/supplier-payments` && r.params.get('supplierId') === 's1')
        .flush([{ id: 'p1', date: '2026-02-01T00:00:00.000Z', method: 'Domiciliacion', amount: 1060, invoices: [] }]);
      expect((await list)[0]).toMatchObject({ date: '2026-02-01', method: 'Domiciliación' });

      const undo = h.service.undoSupplierPayment('p1', 'Devuelto');
      h.http.expectOne(`${API}/supplier-payments/p1/undo`).flush({});
      await undo;

      const ledger = h.service.supplierLedger('e1', 's1');
      h.http.expectOne(`${API}/estates/e1/suppliers/s1/ledger`).flush({ supplierId: 's1', balance: 0, movements: [{ date: '2026-02-01T00:00:00.000Z', balance: 0 }] });
      expect((await ledger).movements[0].date).toBe('2026-02-01');
    });

    it('uploadSupplierInvoiceFile sube multipart y castea la respuesta', async () => {
      const file = new File(['x'], 'factura.pdf');
      const promise = h.service.uploadSupplierInvoiceFile('e1', 's1', 'i1', file);
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices/i1/file`);
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush(rawInvoice({ fileName: 'factura.pdf' }));
      expect((await promise).fileName).toBe('factura.pdf');
    });

    it('downloadSupplierInvoiceFile pide un blob', async () => {
      const promise = h.service.downloadSupplierInvoiceFile('e1', 's1', 'i1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices/i1/file`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(await promise).toBeInstanceOf(Blob);
    });

    it('updateSupplier — PATCH (antes no existía ningún endpoint para corregir un dato)', async () => {
      const promise = h.service.updateSupplier('e1', 's1', { name: 'Nombre corregido' });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Nombre corregido' });
      req.flush({ id: 's1', administratorId: 'a1', estateId: 'e1', name: 'Nombre corregido', category: 'x', status: 'Activo' });
      expect((await promise).name).toBe('Nombre corregido');
    });

    it('updateSupplier con status "Baja" es la forma de dar de baja (nunca DELETE)', async () => {
      const promise = h.service.updateSupplier('e1', 's1', { status: 'Baja' });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1`);
      expect(req.request.body).toEqual({ status: 'Baja' });
      req.flush({ id: 's1', administratorId: 'a1', estateId: 'e1', name: 'x', category: 'x', status: 'Baja' });
      expect((await promise).status).toBe('Baja');
    });

    it('updateSupplierInvoiceDueDate solo cambia el vencimiento', async () => {
      const promise = h.service.updateSupplierInvoiceDueDate('e1', 's1', 'i1', '2026-03-31');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/invoices/i1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ dueDate: '2026-03-31' });
      req.flush(rawInvoice({ dueDate: '2026-03-31T00:00:00.000Z' }));
      expect((await promise).dueDate).toBe('2026-03-31');
    });
  });

  describe('Supplier contracts', () => {
    it('listSupplierContracts normaliza fechas y conserva el status derivado del backend', async () => {
      const promise = h.service.listSupplierContracts('e1', 's1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts`);
      req.flush([{
        id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensores',
        startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z',
        renewalType: 'tacita', status: 'Activo', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }]);
      const [c] = await promise;
      expect(c.startDate).toBe('2026-01-01');
      expect(c.endDate).toBe('2026-12-31');
      expect(c.status).toBe('Activo');
    });

    it('listEstateContracts pide los contratos de la finca y conserva proveedor, estado y días restantes', async () => {
      const promise = h.service.listEstateContracts('e1');
      h.http.expectOne(`${API}/estates/e1/contracts`).flush([{
        id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensores',
        startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z',
        renewalType: 'tacita', status: 'PorVencer', daysLeft: 16,
        supplier: { id: 's1', name: 'Ascensores Levante', category: 'Ascensores' },
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }]);
      const [c] = await promise;
      expect(c.endDate).toBe('2026-11-01');
      expect(c).toMatchObject({ status: 'PorVencer', daysLeft: 16, supplier: { name: 'Ascensores Levante' } });
    });

    it('createSupplierContract — POST con el payload tal cual', async () => {
      const promise = h.service.createSupplierContract('e1', 's1', {
        serviceType: 'Extintores', startDate: '2026-01-01', renewalType: 'manual',
      });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ serviceType: 'Extintores', startDate: '2026-01-01', renewalType: 'manual' });
      req.flush({
        id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Extintores',
        startDate: '2026-01-01', endDate: null, renewalType: 'manual', status: 'Activo',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      });
      expect((await promise).id).toBe('c1');
    });

    it('updateSupplierContract — PATCH parcial', async () => {
      const promise = h.service.updateSupplierContract('e1', 's1', 'c1', { endDate: '2027-01-01' });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts/c1`);
      expect(req.request.method).toBe('PATCH');
      req.flush({
        id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'x',
        startDate: '2026-01-01', endDate: '2027-01-01', renewalType: 'manual', status: 'Activo',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      });
      expect((await promise).endDate).toBe('2027-01-01');
    });

    it('cancelSupplierContract — POST con el motivo, el estado vuelve "Cancelado"', async () => {
      const promise = h.service.cancelSupplierContract('e1', 's1', 'c1', 'Cambio de proveedor');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/contracts/c1/cancel`);
      expect(req.request.body).toEqual({ cancelledReason: 'Cambio de proveedor' });
      req.flush({
        id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'x',
        startDate: '2026-01-01', renewalType: 'manual', status: 'Cancelado',
        cancelledAt: '2026-06-01', cancelledReason: 'Cambio de proveedor',
        createdAt: '2026-01-01', updatedAt: '2026-06-01',
      });
      const result = await promise;
      expect(result.status).toBe('Cancelado');
      expect(result.cancelledAt).toBe('2026-06-01');
    });
  });

  describe('Supplier documents', () => {
    it('listSupplierDocuments normaliza expiresAt (independiente de las fechas del contrato)', async () => {
      const promise = h.service.listSupplierDocuments('e1', 's1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/documents`);
      req.flush([{
        id: 'doc1', supplierId: 's1', documentType: 'Seguro', title: 'Seguro RC',
        fileName: 'seguro.pdf', mimeType: 'application/pdf', expiresAt: '2026-12-31T00:00:00.000Z', createdAt: '2026-01-01',
      }]);
      expect((await promise)[0].expiresAt).toBe('2026-12-31');
    });

    it('uploadSupplierDocument manda documentType/expiresAt/contractId como campos del formulario', async () => {
      const file = new File(['x'], 'seguro.pdf');
      const promise = h.service.uploadSupplierDocument('e1', 's1', file, {
        title: 'Seguro RC 2026', documentType: 'Seguro', expiresAt: '2026-12-31', contractId: 'c1',
      });
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/documents`);
      const body = req.request.body as FormData;
      expect(body.get('title')).toBe('Seguro RC 2026');
      expect(body.get('documentType')).toBe('Seguro');
      expect(body.get('expiresAt')).toBe('2026-12-31');
      expect(body.get('contractId')).toBe('c1');
      req.flush({
        id: 'doc1', supplierId: 's1', contractId: 'c1', documentType: 'Seguro', title: 'Seguro RC 2026',
        fileName: 'seguro.pdf', mimeType: 'application/pdf', expiresAt: '2026-12-31', createdAt: '2026-01-01',
      });
      await promise;
    });

    it('downloadSupplierDocument pide un blob', async () => {
      const promise = h.service.downloadSupplierDocument('e1', 's1', 'doc1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/documents/doc1/file`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(await promise).toBeInstanceOf(Blob);
    });

    it('deleteSupplierDocument — DELETE', async () => {
      const promise = h.service.deleteSupplierDocument('e1', 's1', 'doc1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/documents/doc1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await promise;
    });
  });

  describe('Supplier performance', () => {
    it('getSupplierPerformance — GET simple', async () => {
      const promise = h.service.getSupplierPerformance('e1', 's1');
      const req = h.http.expectOne(`${API}/estates/e1/suppliers/s1/performance`);
      req.flush({ totalIssuesAssigned: 5, resolvedIssues: 3, openIssues: 2 });
      expect(await promise).toEqual({ totalIssuesAssigned: 5, resolvedIssues: 3, openIssues: 2 });
    });
  });

  describe('Staff (personal contratado)', () => {
    it('listStaffByEstate — GET simple', async () => {
      const promise = h.service.listStaffByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/staff`);
      req.flush([{ id: 'st1', estateId: 'e1', administratorId: 'a1', fullName: 'Juan', position: 'Portero', contractType: 'Indefinido', startDate: '2020-01-01', status: 'Activo' }]);
      expect((await promise)[0].fullName).toBe('Juan');
    });

    it('createStaffMember manda el payload y devuelve el creado', async () => {
      const payload = { fullName: 'Ana', position: 'Seguridad', contractType: 'Temporal' as const, startDate: '2026-01-01' };
      const promise = h.service.createStaffMember('e1', payload);
      const req = h.http.expectOne(`${API}/estates/e1/staff`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 'st2', estateId: 'e1', administratorId: 'a1', ...payload, status: 'Activo' });
      expect((await promise).fullName).toBe('Ana');
    });

    it('updateStaffMember — PATCH (p.ej. dar de baja)', async () => {
      const promise = h.service.updateStaffMember('e1', 'st1', { status: 'Baja', endDate: '2026-06-01' });
      const req = h.http.expectOne(`${API}/estates/e1/staff/st1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'Baja', endDate: '2026-06-01' });
      req.flush({ id: 'st1', estateId: 'e1', administratorId: 'a1', fullName: 'x', position: 'x', contractType: 'Indefinido', startDate: '2020-01-01', status: 'Baja', endDate: '2026-06-01' });
      await promise;
    });

    it('listStaffDocuments — GET simple', async () => {
      const promise = h.service.listStaffDocuments('e1', 'st1');
      const req = h.http.expectOne(`${API}/estates/e1/staff/st1/documents`);
      req.flush([{ id: 'd1', staffMemberId: 'st1', title: 'DNI', fileName: 'dni.pdf', mimeType: 'application/pdf', createdAt: '2026-01-01' }]);
      expect((await promise)[0].title).toBe('DNI');
    });

    it('uploadStaffDocument manda el título como campo del formulario', async () => {
      const file = new File(['x'], 'dni.pdf');
      const promise = h.service.uploadStaffDocument('e1', 'st1', 'DNI', file);
      const req = h.http.expectOne(`${API}/estates/e1/staff/st1/documents`);
      expect(req.request.body instanceof FormData).toBe(true);
      expect((req.request.body as FormData).get('title')).toBe('DNI');
      req.flush({ id: 'd1', staffMemberId: 'st1', title: 'DNI', fileName: 'dni.pdf', mimeType: 'application/pdf', createdAt: '2026-01-01' });
      await promise;
    });

    it('downloadStaffDocument pide un blob', async () => {
      const promise = h.service.downloadStaffDocument('e1', 'st1', 'd1');
      const req = h.http.expectOne(`${API}/estates/e1/staff/st1/documents/d1/file`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(await promise).toBeInstanceOf(Blob);
    });

    it('deleteStaffDocument — DELETE', async () => {
      const promise = h.service.deleteStaffDocument('e1', 'st1', 'd1');
      const req = h.http.expectOne(`${API}/estates/e1/staff/st1/documents/d1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await promise;
    });

    it('listStaffDirectory — el subconjunto público para el propietario', async () => {
      const promise = h.service.listStaffDirectory('e1');
      const req = h.http.expectOne(`${API}/estates/e1/staff/directory`);
      req.flush([{ id: 'st1', fullName: 'Juan', position: 'Portero', phone: '600000000' }]);
      const [entry] = await promise;
      expect(entry.fullName).toBe('Juan');
      // El directorio nunca debe traer datos de RRHH — esto es responsabilidad
      // del backend, pero se confirma que el frontend no los añade ni los espera.
      expect((entry as unknown as { nationalId?: unknown }).nationalId).toBeUndefined();
    });
  });
});
