import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { DebtorsService } from './debtors.service';

describe('DebtorsService', () => {
  let h: ApiServiceHarness<DebtorsService>;

  beforeEach(() => {
    h = setupApiService(DebtorsService);
  });

  afterEach(() => h.http.verify());

  describe('Debtors', () => {
    it('listDebtors castea amount/interest y normaliza fechas', async () => {
      const promise = h.service.listDebtors();
      const req = h.http.expectOne(`${API}/debtors`);
      req.flush([{ id: 'd1', amount: '150.50', interest: '5.25', oldest: '2025-11-01T00:00:00.000Z', lastContact: '2026-01-01T00:00:00.000Z' }]);
      const [debtor] = await promise;
      expect(debtor.amount).toBe(150.5);
      expect(debtor.interest).toBe(5.25);
      expect(debtor.oldest).toBe('2025-11-01');
      expect(debtor.lastContact).toBe('2026-01-01');
    });

    it('lastContact null se conserva como null, no se fuerza a fecha vacía', async () => {
      const promise = h.service.listDebtors();
      const req = h.http.expectOne(`${API}/debtors`);
      req.flush([{ id: 'd1', amount: '0', interest: '0', oldest: '2025-01-01', lastContact: null }]);
      expect((await promise)[0].lastContact).toBeNull();
    });

    it('listDebtorsByEstate mapea igual, acotado a una finca', async () => {
      const promise = h.service.listDebtorsByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/debtors`);
      req.flush([{ id: 'd1', amount: '10', interest: '0', oldest: '2025-01-01', lastContact: null }]);
      expect((await promise)[0].amount).toBe(10);
    });

    it('mapea titular→name, aplana la propiedad a una etiqueta, y reminderL1/L2/Bf→reminders — el backend no tiene columna "name" ni "reminders"', async () => {
      const promise = h.service.listDebtorsByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/debtors`);
      req.flush([{
        id: 'd1', amount: '10', interest: '0', oldest: '2025-01-01', lastContact: null,
        titular: 'Ana García', property: { ref: '3A', staircase: '1', floor: null, door: null },
        reminderL1: true, reminderL2: false, reminderBf: true,
      }]);
      const [debtor] = await promise;
      expect(debtor.name).toBe('Ana García');
      expect(debtor.property).toBe('3A esc. 1');
      expect(debtor.reminders).toEqual({ l1: true, l2: false, bf: true });
    });

    it('sin titular vinculado, cae a "Sin titular" en vez de undefined', async () => {
      const promise = h.service.listDebtors();
      const req = h.http.expectOne(`${API}/debtors`);
      req.flush([{ id: 'd1', amount: '10', interest: '0', oldest: '2025-01-01', lastContact: null, titular: null }]);
      expect((await promise)[0].name).toBe('Sin titular');
    });
  });

  describe('Neighbour balances (tarea 12 — saldo de TODA la finca, no solo morosidad gestionada)', () => {
    it('listBalancesByEstate castea el saldo y normaliza la fecha de contacto', async () => {
      const promise = h.service.listBalancesByEstate('e1');
      const req = h.http.expectOne(`${API}/estates/e1/debtors/balances`);
      req.flush([{
        propertyId: 'p1', property: { ref: '1A', staircase: null, floor: null, door: null },
        titular: 'Juan', email: 'juan@x.com', phone: null, balance: '150.75', advance: '30.00', isUpToDate: false,
        debtorId: 'd1', monthsOverdue: 2, step: 'Aviso enviado', lastContact: '2026-01-01T00:00:00.000Z',
        reminderL1: true, reminderL2: false, reminderBf: false,
      }]);
      const [row] = await promise;
      expect(row.balance).toBe(150.75);
      expect(row.advance).toBe(30);
      expect(row.lastContact).toBe('2026-01-01');
    });

    it('sin anticipo en la respuesta, advance se normaliza a 0', async () => {
      const promise = h.service.listBalancesByEstate('e1');
      h.http.expectOne(`${API}/estates/e1/debtors/balances`).flush([{
        propertyId: 'p1', property: { ref: '1A', staircase: null, floor: null, door: null },
        titular: 'Juan', email: null, phone: null, balance: '0', isUpToDate: true,
        debtorId: null, monthsOverdue: 0, step: null, lastContact: null,
        reminderL1: false, reminderL2: false, reminderBf: false,
      }]);
      const [row] = await promise;
      expect(row.advance).toBe(0);
    });

    it('downloadBalancesExcel pide el .xlsx como blob', async () => {
      const promise = h.service.downloadBalancesExcel('e1');
      const req = h.http.expectOne(`${API}/estates/e1/debtors/balances.xlsx`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['fake']));
      await expect(promise).resolves.toBeInstanceOf(Blob);
    });

    it('downloadDebtCertificatePdf pide el PDF como blob', async () => {
      const promise = h.service.downloadDebtCertificatePdf('prop1');
      const req = h.http.expectOne(`${API}/properties/prop1/debt-certificate.pdf`);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['%PDF']));
      await expect(promise).resolves.toBeInstanceOf(Blob);
    });
  });

  describe('Debtor actions', () => {
    it('listActionsForDebtor traduce el tipo de gestión y normaliza la fecha', async () => {
      const promise = h.service.listActionsForDebtor('d1');
      const req = h.http.expectOne(`${API}/debtors/d1/actions`);
      req.flush([{ id: 'a1', debtorId: 'd1', type: 'CartaFormal', date: '2026-01-01T00:00:00.000Z', note: 'x' }]);
      expect((await promise)[0].type).toBe('Carta formal');
    });

    it('addDebtorAction traduce el tipo hacia la API y omite result/onBehalfOfUserId vacíos', async () => {
      const promise = h.service.addDebtorAction({ debtorId: 'd1', author: 'Gestora', type: 'Llamada', date: '2026-01-01', note: 'nota', result: '' });
      const req = h.http.expectOne(`${API}/debtors/d1/actions`);
      expect(req.request.body).toEqual({ type: 'Llamada', date: '2026-01-01', note: 'nota', result: undefined, onBehalfOfUserId: undefined });
      req.flush({ id: 'a1', debtorId: 'd1', type: 'Llamada', date: '2026-01-01', note: 'nota' });
      await promise;
    });
  });

  describe('Payment agreements', () => {
    it('findActiveAgreementForDebtor normaliza fechas', async () => {
      const promise = h.service.findActiveAgreementForDebtor('d1');
      const req = h.http.expectOne(`${API}/debtors/d1/agreement`);
      req.flush({ id: 'ag1', debtorId: 'd1', totalAmount: 500, downPaymentAmount: 100, installmentsCount: 4, firstDueDate: '2026-02-01T00:00:00.000Z', status: 'active', signedAt: '2026-01-01T00:00:00.000Z', createdByUserId: 'u1' });
      const agreement = await promise;
      expect(agreement?.firstDueDate).toBe('2026-02-01');
      expect(agreement?.signedAt).toBe('2026-01-01');
    });

    it('findActiveAgreementForDebtor devuelve null si no hay ninguno vigente', async () => {
      const promise = h.service.findActiveAgreementForDebtor('d1');
      const req = h.http.expectOne(`${API}/debtors/d1/agreement`);
      req.flush(null);
      expect(await promise).toBeNull();
    });

    it('findActiveAgreementForDebtor devuelve null si falla la petición', async () => {
      const promise = h.service.findActiveAgreementForDebtor('d1');
      const req = h.http.expectOne(`${API}/debtors/d1/agreement`);
      req.flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
      expect(await promise).toBeNull();
    });

    it('listInstallmentsForAgreement normaliza fechas y ordena por seq (aunque la API los mande desordenados)', async () => {
      const promise = h.service.listInstallmentsForAgreement('ag1');
      const req = h.http.expectOne(`${API}/payment-agreements/ag1/installments`);
      req.flush([
        { id: 'i2', agreementId: 'ag1', seq: 2, dueDate: '2026-04-01', amount: 100 },
        { id: 'i0', agreementId: 'ag1', seq: 0, dueDate: '2026-02-01', amount: 100, paidAt: '2026-02-01' },
        { id: 'i1', agreementId: 'ag1', seq: 1, dueDate: '2026-03-01', amount: 100 },
      ]);
      const result = await promise;
      expect(result.map((i) => i.seq)).toEqual([0, 1, 2]);
      expect(result[0].paidAt).toBe('2026-02-01');
    });

    it('createPaymentAgreement omite downPaymentAmount cuando es 0 (falsy)', async () => {
      const promise = h.service.createPaymentAgreement({ debtorId: 'd1', totalAmount: 400, downPaymentAmount: 0, installmentsCount: 4, firstDueDate: '2026-02-01' });
      const req = h.http.expectOne(`${API}/debtors/d1/agreement`);
      expect(req.request.body.downPaymentAmount).toBeUndefined();
      req.flush({ id: 'ag1', debtorId: 'd1', totalAmount: 400, downPaymentAmount: 0, installmentsCount: 4, firstDueDate: '2026-02-01', status: 'active', signedAt: '2026-01-01', createdByUserId: 'u1' });
      await promise;
    });

    it('createPaymentAgreement conserva downPaymentAmount cuando es > 0', async () => {
      const promise = h.service.createPaymentAgreement({ debtorId: 'd1', totalAmount: 400, downPaymentAmount: 50, installmentsCount: 4, firstDueDate: '2026-02-01' });
      const req = h.http.expectOne(`${API}/debtors/d1/agreement`);
      expect(req.request.body.downPaymentAmount).toBe(50);
      req.flush({ id: 'ag1', debtorId: 'd1', totalAmount: 400, downPaymentAmount: 50, installmentsCount: 4, firstDueDate: '2026-02-01', status: 'active', signedAt: '2026-01-01', createdByUserId: 'u1' });
      await promise;
    });

    it('markInstallmentPaid — PATCH con la fecha y el método del cobro', async () => {
      const promise = h.service.markInstallmentPaid('i1', { date: '2026-04-02', method: 'Pago en oficina' });
      const req = h.http.expectOne(`${API}/payment-installments/i1/paid`);
      expect(req.request.body).toEqual({ date: '2026-04-02', method: 'PagoEnOficina' });
      req.flush(null);
      await promise;
    });

    it('cancelPaymentAgreement — POST con el motivo', async () => {
      const promise = h.service.cancelPaymentAgreement('ag1', 'Acuerdo incumplido');
      const req = h.http.expectOne(`${API}/payment-agreements/ag1/cancel`);
      expect(req.request.body).toEqual({ cancelledReason: 'Acuerdo incumplido' });
      req.flush(null);
      await promise;
    });
  });
});
