import {
  ReceiptPostingService,
  type IssueReceiptInput,
} from './receipt-posting.service';

describe('receipt emission semantics', () => {
  const emitted = new Date('2026-10-15T12:34:56Z');
  let stored: any;
  const journal: any = {
    reserveConfig: async () => ({ mode: 'none', sharePct: null }),
    post: async () => ({ id: 'entry' }),
  };
  const db: any = {
    accountingSettings: {
      findUnique: async () => ({ cutoverDate: new Date('2026-01-01') }),
    },
    chartAccount: { findFirst: async () => ({ id: 'account' }) },
    accountingReceipt: {
      create: async ({ data }: any) => {
        stored = { id: 'receipt', ...data };
        return stored;
      },
      update: async ({ data }: any) => Object.assign(stored, data),
    },
  };
  const input: IssueReceiptInput = {
    estateId: 'estate',
    periodId: 'period',
    periodKey: '2026-10',
    propertyId: 'property',
    no: '2026/10-001',
    concept: 'Cuota',
    kind: 'cuota_ordinaria',
    amount: 10000,
    method: 'Pendiente',
    manual: false,
  };
  afterEach(() => jest.useRealTimers());
  it('records the emission instant independently of accrual and mutable display date', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(emitted);
    const receipt = await new ReceiptPostingService(journal).issue(db, {
      ...input,
      date: new Date('2026-10-01'),
    });
    expect(receipt.issuedAt).toEqual(emitted);
    expect(receipt.accrualDate.toISOString().slice(0, 10)).toBe('2026-10-01');
  });
  it('retains unknown original emission date for imported legacy documents', async () => {
    const receipt = await new ReceiptPostingService(journal).issue(db, {
      ...input,
      issuedAt: null,
      manual: true,
    });
    expect(receipt.issuedAt).toBeNull();
  });
});
