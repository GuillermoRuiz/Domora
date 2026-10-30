import { Prisma } from '../prisma/client';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Open-item debt at a business date, reconstructed from the same 430 ledger
 * which validates the live outstanding cache. Current statuses cannot describe
 * the past: cancellations, partial collections and returns enter through journal. */
export async function queryReceiptDebtAt(
  prisma: PrismaService,
  estateIds: string[],
  asOf: Date,
  propertyId?: string,
) {
  const rows = await prisma.journalLine.groupBy({
    by: ['receiptId'],
    where: {
      estateId: { in: estateIds },
      receiptId: { not: null },
      ...(propertyId ? { propertyId } : {}),
      date: { lte: asOf },
      entryType: { notIn: LedgerQueryService.BALANCE_EXCLUDED },
      account: { code: { startsWith: '430' } },
    },
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((row) => [
      row.receiptId!,
      new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0),
    ]),
  );
}
