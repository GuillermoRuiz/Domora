/* eslint-disable @typescript-eslint/no-explicit-any */
import { WeeklyAiService, ageDays, percentOver } from './weekly-ai.service';
const calc = (tenant: string) => {
  const queries: any[] = [];
  const scoped =
    (model: string, method: string, value: any) => async (args: any) => {
      queries.push({ model, method, args });
      return value;
    };
  const tx: any = {
    estate: {
      findFirst: scoped('estate', 'findFirst', {
        id: tenant,
        name: 'Comunidad',
      }),
    },
    issue: {
      count: scoped('issue', 'count', 3),
      findMany: scoped('issue', 'findMany', [
        { id: 'issue', ref: '#INC', createdAt: new Date('2026-09-25T00:00Z') },
      ]),
      findFirst: scoped('issue', 'findFirst', null),
    },
    issueWait: { findMany: scoped('issueWait', 'findMany', []) },
    supplierContract: { findMany: scoped('supplierContract', 'findMany', []) },
    supplierInvoice: {
      count: scoped('supplierInvoice', 'count', 2),
      aggregate: scoped('supplierInvoice', 'aggregate', {
        _sum: { outstanding: '100.00' },
      }),
      findMany: scoped('supplierInvoice', 'findMany', []),
    },
    bankExtractEntry: {
      groupBy: scoped('bankExtractEntry', 'groupBy', [
        { bankAccountId: 'bank', _count: { _all: 2 } },
      ]),
    },
    journalLine: {
      aggregate: async (args: any) => {
        queries.push({ model: 'journalLine', args });
        return args.where.account.systemRole
          ? { _sum: { debit: '1000.00', credit: '500.00' } }
          : { _sum: { debit: '1120.00', credit: '0' } };
      },
      groupBy: async (args: any) => {
        queries.push({ model: 'journalLine', args });
        const from = args.where.date.gte.toISOString(); // Limpieza: 2.000 € en el año, 1.450 € en los últimos 30 días y 1.000 € en los 30 anteriores.
        const debit = from.startsWith('2026-01-01')
          ? '2000.00'
          : from >= '2026-09-04'
            ? '1450.00'
            : '1000.00';
        return [{ accountId: 'a1', _sum: { debit, credit: '0' } }];
      },
    },
    chartAccount: {
      findMany: scoped('chartAccount', 'findMany', [
        { id: 'a1', name: 'Limpieza', shortName: null },
      ]),
    },
    budgetItem: {
      aggregate: scoped('budgetItem', 'aggregate', {
        _sum: { budgeted: '1000.00' },
      }),
      findMany: scoped('budgetItem', 'findMany', [
        { accountId: 'a1', budgeted: '1500.00' },
      ]),
    },
    propertyEvent: { findMany: scoped('propertyEvent', 'findMany', []) },
  };
  return { db: { $transaction: (fn: any) => fn(tx) }, queries };
};
describe('Weekly deterministic community snapshot', () => {
  it('calculates ageing and annual budget deviation in code', () => {
    expect(
      ageDays(new Date('2026-09-25T00:00Z'), new Date('2026-10-03T00:00Z')),
    ).toBe(8);
    expect(percentOver(112000, 100000)).toBe(12);
    expect(percentOver(1, 0)).toBeNull();
  });
  it('returns facts from the correct community and actual cents', async () => {
    const f = calc('e1');
    const s = new WeeklyAiService(f.db as any, {} as any, {} as any);
    const result = await s.snapshot('e1', new Date('2026-10-03T00:00Z'));
    expect(result.facts.community_id).toBe('e1');
    expect(result.facts.finance.cash_and_bank_balance_cents).toBe(50000);
    expect(result.facts.finance.over_annual_budget_percent).toBe(12);
    expect(result.facts.accounting.unreconciled_transactions).toBe(2);
  });
  it('emite avisos de gasto por partida y ninguno de facturas ni bancos', async () => {
    const f = calc('e1');
    const s = new WeeklyAiService(f.db as any, {} as any, {} as any);
    const result = await s.snapshot('e1', new Date('2026-10-03T00:00Z'));
    const facts = result.signals.map((x: any) => x.fact) as string[];
    expect(
      facts.some((x) => x.includes('«Limpieza»') && x.includes('33,33% más')),
    ).toBe(true);
    expect(
      facts.some((x) => x.includes('«Limpieza»') && x.includes('45% más')),
    ).toBe(true);
    expect(facts.some((x) => x.includes('el 100% del gasto total'))).toBe(true);
    expect(
      result.signals.some(
        (x: any) => x.entity_type === 'invoice' || x.entity_type === 'bank',
      ),
    ).toBe(false);
    expect(result.facts.finance.expense_by_category[0]).toMatchObject({
      category: 'Limpieza',
      year_to_date_cents: 200000,
      annual_budget_cents: 150000,
    });
  });
  it('scopes every underlying snapshot query', async () => {
    const f = calc('e2');
    const s = new WeeklyAiService(f.db as any, {} as any, {} as any);
    await s.snapshot('e2', new Date('2026-10-03T00:00Z'));
    expect(
      f.queries.every((q) => JSON.stringify(q.args.where).includes('e2')),
    ).toBe(true);
  });
});
