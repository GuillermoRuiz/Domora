import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let h: ApiServiceHarness<LedgerService>;

  beforeEach(() => {
    h = setupApiService(LedgerService);
  });

  afterEach(() => h.http.verify());

  it('listBankAccounts convierte el saldo (Decimal en string) a número', async () => {
    const p = h.service.listBankAccounts('e1');
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([
      { id: 'b1', alias: 'Principal', accountCode: '5720001', ibanMasked: 'ES91 ···· 1332', bic: null, bankName: null, isDefault: true, isReserveAccount: false, openedOn: null, closedAt: null, balance: '1234.50' },
    ]);
    const [bank] = await p;
    expect(bank.balance).toBe(1234.5);
    expect(typeof bank.balance).toBe('number');
  });

  it('createBankAccount y updateBankAccount devuelven la lista completa actualizada', async () => {
    const created = h.service.createBankAccount('e1', { alias: 'Obras', iban: 'ES9121000418450200051332' });
    const createReq = h.http.expectOne(`${API}/estates/e1/bank-accounts`);
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({ alias: 'Obras', iban: 'ES9121000418450200051332' });
    createReq.flush([{ id: 'b1', balance: '0' }, { id: 'b2', balance: '0' }]);
    expect(await created).toHaveLength(2);

    const updated = h.service.updateBankAccount('e1', 'b2', { isDefault: true });
    const updReq = h.http.expectOne(`${API}/estates/e1/bank-accounts/b2`);
    expect(updReq.request.method).toBe('PATCH');
    expect(updReq.request.body).toEqual({ isDefault: true });
    updReq.flush([{ id: 'b1', balance: '0' }, { id: 'b2', balance: '0' }]);
    await updated;
  });

  it('updateAccountingSettings manda solo la fecha con PUT', async () => {
    const p = h.service.updateAccountingSettings('e1', '2026-01-01');
    const req = h.http.expectOne(`${API}/estates/e1/accounting-settings`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ cutoverDate: '2026-01-01' });
    req.flush({ cutoverDate: '2026-01-01', firstEntryDate: null, hasOpeningEntry: false, cutoverEditable: true });
    expect((await p).cutoverDate).toBe('2026-01-01');
  });
});
