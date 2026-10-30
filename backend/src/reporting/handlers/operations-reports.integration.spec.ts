import type { PrismaService } from '../../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { JournalService } from '../../ledger/journal/journal.service';
import { SupplierPostingService } from '../../ledger/posting/supplier-posting.service';
import { OperationsReportsService } from './operations-reports.service';
import type { ReportScope } from '../reporting.types';
import { createPrismaClient } from '../../prisma/create-prisma-client';

jest.setTimeout(120000);
const prisma = createPrismaClient();
const service = new OperationsReportsService(
  prisma as unknown as PrismaService,
);
const posting = new SupplierPostingService(new JournalService());
const D = (value: string) => new Date(`${value}T00:00:00Z`);
let admin: AdministratorFixture;
let scope: ReportScope;
let estate: string;
let supplier: string;
beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Reporting supplier integration',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  supplier = await createSupplier(prisma, estate, admin.administratorId);
  scope = {
    administratorId: admin.administratorId,
    user: roleB(admin, [estate]),
    mode: 'selected',
    estateIds: [estate],
    estates: [{ id: estate, name: 'Fixture' }],
  };
  const account = await prisma.chartAccount.findFirstOrThrow({
    where: { estateId: estate, code: '628' },
  });
  const invoice = await prisma.$transaction((tx) =>
    posting.registerInvoice(tx, {
      estateId: estate,
      supplierId: supplier,
      number: 'INV-REPORT-1',
      concept: 'Prueba',
      issueDate: D('2026-09-01'),
      vatRatePct: 0,
      withholdingRatePct: 0,
      lines: [{ accountId: account.id, base: 10000 }],
    }),
  );
  const payment = await prisma.$transaction((tx) =>
    posting.pay(tx, {
      estateId: estate,
      supplierId: supplier,
      date: D('2026-10-01'),
      amount: 5000,
      method: 'Transferencia',
      invoiceIds: [invoice.id],
    }),
  );
  await prisma.$transaction((tx) =>
    posting.undoPayment(tx, payment.id, {
      date: D('2026-10-10'),
      reason: 'Prueba de reversión',
    }),
  );
  await prisma.$transaction((tx) =>
    posting.cancelInvoice(tx, invoice.id, {
      date: D('2026-10-15'),
      reason: 'Prueba de anulación',
    }),
  );
  await prisma.supplierContract.createMany({
    data: [
      {
        estateId: estate,
        supplierId: supplier,
        serviceType: 'Activo',
        startDate: D('2026-01-01'),
        endDate: D('2026-10-25'),
        renewalType: 'manual',
        costAmount: '10',
        costFrequency: 'MONTHLY',
        currency: 'EUR',
      },
      {
        estateId: estate,
        supplierId: supplier,
        serviceType: 'Futuro',
        startDate: D('2026-11-01'),
        endDate: D('2027-01-01'),
        renewalType: 'manual',
      },
    ],
  });
});
afterAll(async () => {
  if (admin) await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

it('keeps invoiced current, accrued period and paid net as different bases', async () => {
  const run = (
    basis: 'invoiced' | 'accrued' | 'paid',
    from: string,
    to: string,
  ) =>
    service.run(
      'supplier-spend',
      { scopeMode: 'selected', from, to, filters: { spendBasis: basis } },
      scope,
    );
  expect(
    (await run('invoiced', '2026-09-01', '2026-09-30')).sections[0].rows,
  ).toEqual([]);
  expect(
    (await run('accrued', '2026-09-01', '2026-09-30')).summary?.[0].value,
  ).toBe(100);
  expect(
    (await run('accrued', '2026-09-01', '2026-10-31')).summary?.[0].value,
  ).toBe(0);
  expect(
    (await run('paid', '2026-10-01', '2026-10-01')).summary?.[0].value,
  ).toBe(50);
  expect(
    (await run('paid', '2026-10-01', '2026-10-31')).summary?.[0].value,
  ).toBe(0);
});
it('excludes future starts and returns real contractual costs', async () => {
  const report = await service.run(
    'contracts-active',
    { scopeMode: 'selected', asOf: '2026-10-15' },
    scope,
  );
  expect(report.sections[0].rows).toHaveLength(1);
  expect(report.sections[0].rows[0]).toMatchObject({
    service: 'Activo',
    cost: 10,
    annual: 120,
  });
  const expiring = await service.run(
    'contracts-expiring',
    { scopeMode: 'selected', asOf: '2026-10-15', filters: { days: 30 } },
    scope,
  );
  expect(expiring.sections[0].rows).toHaveLength(1);
});
