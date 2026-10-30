import type { PrismaService } from '../../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { JournalService } from '../../ledger/journal/journal.service';
import { ReceiptPostingService } from '../../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../../ledger/posting/collection-posting.service';
import { ReceiptReportsService } from './receipt-reports.service';
import type { ReportScope } from '../reporting.types';
import { createPrismaClient } from '../../prisma/create-prisma-client';

jest.setTimeout(120000);
const prisma = createPrismaClient();
const service = new ReceiptReportsService(prisma as unknown as PrismaService);
const journal = new JournalService();
const receipts = new ReceiptPostingService(journal);
const collections = new CollectionPostingService(journal, receipts);
const D = (value: string) => new Date(`${value}T00:00:00Z`);
let admin: AdministratorFixture;
let scope: ReportScope;
let estate: string;
const ids = new Map<string, string>();

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Reporting debt integration',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  scope = {
    administratorId: admin.administratorId,
    user: roleB(admin, [estate]),
    mode: 'selected',
    estateIds: [estate],
    estates: [{ id: estate, name: 'Fixture' }],
  };
  for (const [label, due] of [
    ['future', '2026-10-16'],
    ['ten', '2026-10-05'],
    ['partial', '2026-08-31'],
    ['returned', '2026-08-01'],
    ['old', '2026-06-17'],
    ['unknown', null],
    ['cancel', '2026-08-01'],
    ['zero', '2026-08-01'],
  ] as const) {
    const property = await createProperty(prisma, estate);
    const receipt = await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: property,
      periodKey: '2026-01',
      amount: '100.00',
      dueDate: due ? D(due) : undefined,
    });
    ids.set(label, receipt.id);
    if (label === 'partial')
      await prisma.$transaction((tx) =>
        collections.collect(tx, {
          estateId: estate,
          propertyId: property,
          date: D('2026-10-10'),
          amount: 2500,
          method: 'Transferencia',
          receiptIds: [receipt.id],
        }),
      );
    if (label === 'returned') {
      const collection = await prisma.$transaction((tx) =>
        collections.collect(tx, {
          estateId: estate,
          propertyId: property,
          date: D('2026-10-01'),
          amount: 10000,
          method: 'Transferencia',
          receiptIds: [receipt.id],
        }),
      );
      await prisma.$transaction((tx) =>
        collections.returnCollection(tx, collection.id, {
          date: D('2026-10-12'),
        }),
      );
    }
    if (label === 'cancel')
      await prisma.$transaction((tx) =>
        receipts.cancel(tx, receipt.id, {
          date: D('2026-09-01'),
          reason: 'Test cancellation',
        }),
      );
    if (label === 'zero')
      await prisma.$transaction((tx) =>
        collections.collect(tx, {
          estateId: estate,
          propertyId: property,
          date: D('2026-01-02'),
          amount: 10000,
          method: 'Transferencia',
          receiptIds: [receipt.id],
        }),
      );
  }
});
afterAll(async () => {
  if (admin) await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

it('uses disjoint aging, partial debt, returns, cancellation and zero from real journal', async () => {
  const report = await service.run(
    'debt-aging',
    { scopeMode: 'selected', asOf: '2026-10-15' },
    scope,
  );
  const row = report.sections[0].rows[0];
  expect(row).toMatchObject({
    notDue: 100,
    under30: 100,
    '30to60': 75,
    '61to90': 100,
    over90: 100,
    unknown: 100,
    total: 575,
  });
  const data = await service.debtAt(
    { scopeMode: 'selected', asOf: '2026-10-15' },
    scope,
  );
  expect(
    data.rows.some(
      (r) => r.id === ids.get('cancel') || r.id === ids.get('zero'),
    ),
  ).toBe(false);
});
it('reconstructs historical payments and returns instead of leaking the current cache', async () => {
  const early = await service.debtAt(
    { scopeMode: 'selected', asOf: '2026-10-09' },
    scope,
  );
  expect(
    early.rows.find((r) => r.id === ids.get('partial'))?.balance.toString(),
  ).toBe('100');
  expect(early.rows.some((r) => r.id === ids.get('returned'))).toBe(false);
  const middle = await service.debtAt(
    { scopeMode: 'selected', asOf: '2026-10-11' },
    scope,
  );
  expect(
    middle.rows.find((r) => r.id === ids.get('partial'))?.balance.toString(),
  ).toBe('75');
  expect(middle.rows.some((r) => r.id === ids.get('returned'))).toBe(false);
});
it('does not read receipt metadata outside the already validated estate scope', async () => {
  const emptyScope = { ...scope, estateIds: [], estates: [] };
  const report = await service.run(
    'receipts',
    { scopeMode: 'all', from: '2026-01-01', to: '2026-12-31' },
    emptyScope,
  );
  expect(report.sections[0].rows).toEqual([]);
});
