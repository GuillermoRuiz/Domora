/* eslint-disable @typescript-eslint/no-explicit-any */
import { AccountingAiService } from './accounting-ai.service';
function fixture() {
  const proposal: any = {
    id: 's',
    estateId: 'e1',
    bankAccountId: 'b',
    entryIds: ['entry'],
    lineIds: ['line'],
    invoiceIds: [],
    status: 'suggested',
    evidence: { tier: 'medium' },
  };
  const entry: any = {
    id: 'entry',
    estateId: 'e1',
    bankAccountId: 'b',
    amount: '-1200.00',
    date: new Date('2026-10-02'),
    reconciliationGroupId: null,
  };
  const line: any = {
    id: 'line',
    estateId: 'e1',
    accountId: 'account',
    debit: '0.00',
    credit: '1200.00',
    date: new Date('2026-10-01'),
    reconciliation: null,
  };
  const db: any = {
    aiReconciliationSuggestion: {
      findFirst: jest.fn().mockResolvedValue(proposal),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve(Object.assign(proposal, data)),
        ),
    },
    bankAccount: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'b',
        estateId: 'e1',
        chartAccountId: 'account',
      }),
    },
    bankExtractEntry: {
      findMany: jest.fn().mockResolvedValue([entry]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    journalLine: { findMany: jest.fn().mockResolvedValue([line]) },
    reconciliationGroup: {
      create: jest.fn().mockResolvedValue({ id: 'group' }),
    },
    reconciliationLine: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aiAudit: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = (work: any) => work(db);
  const access: any = { manager: jest.fn().mockResolvedValue(undefined) };
  return {
    db,
    proposal,
    entry,
    line,
    access,
    service: new AccountingAiService(
      db,
      access,
      {} as any,
      { autoReconcile: false } as any,
    ),
  };
}
describe('Atomic accounting review boundary', () => {
  const actor = { id: 'manager', role: 'B' } as any;
  it('creates only reconciliation links and returns the same group on replay', async () => {
    const f = fixture();
    expect(await f.service.accept('e1', 's', actor)).toEqual({
      groupId: 'group',
    });
    expect(await f.service.accept('e1', 's', actor)).toEqual({
      groupId: 'group',
    });
    expect(f.db.reconciliationGroup.create).toHaveBeenCalledTimes(1);
    expect(f.access.manager).toHaveBeenCalledWith('e1', actor);
    expect(
      f.db.aiAudit.create.mock.calls[0][0].data.details.financialPosting,
    ).toBe(false);
  });
  it('rejects a changed amount before making accounting links', async () => {
    const f = fixture();
    f.entry.amount = '-1199.99';
    await expect(f.service.accept('e1', 's', actor)).rejects.toThrow(
      'no cuadran',
    );
    expect(f.db.reconciliationGroup.create).not.toHaveBeenCalled();
  });
  it('rejects previously reconciled movements', async () => {
    const f = fixture();
    f.entry.reconciliationGroupId = 'other';
    await expect(f.service.accept('e1', 's', actor)).rejects.toThrow(
      'ya conciliadas',
    );
    expect(f.db.reconciliationGroup.create).not.toHaveBeenCalled();
  });
  it('cannot directly reconcile an unposted invoice candidate', async () => {
    const f = fixture();
    f.proposal.lineIds = [];
    f.db.journalLine.findMany.mockResolvedValue([]);
    await expect(f.service.accept('e1', 's', actor)).rejects.toThrow(
      'Partidas cambiadas',
    );
    expect(f.db.reconciliationGroup.create).not.toHaveBeenCalled();
  });
  it('requires tenant authorization before loading a proposal', async () => {
    const f = fixture();
    f.access.manager.mockRejectedValue(new Error('DENIED'));
    await expect(f.service.accept('e2', 's', actor)).rejects.toThrow('DENIED');
    expect(f.db.aiReconciliationSuggestion.findFirst).not.toHaveBeenCalled();
  });
});
