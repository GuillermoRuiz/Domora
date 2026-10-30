import { Prisma } from '../prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/** Bulk, scoped equivalents of the invoice/payment/expense reads. The source
 * journal entry links expense lines to an invoice: expense lines themselves do
 * not carry supplierId. Undo/cancellation entries retain their accounting date. */
export async function supplierSpend(
  prisma: PrismaService,
  estateIds: string[],
  basis: 'invoiced' | 'accrued' | 'paid',
  from?: Date,
  to?: Date,
  supplierId?: string,
) {
  if (!estateIds.length) return [];
  const scope = Prisma.join(estateIds.map((id) => Prisma.sql`${id}::uuid`));
  const filters = (alias: Prisma.Sql) => Prisma.sql`${alias} IN (${scope})`;
  if (basis === 'invoiced') {
    const rows = await prisma.supplierInvoice.groupBy({
      by: ['estateId', 'supplierId'],
      where: {
        estateId: { in: estateIds },
        ...(supplierId ? { supplierId } : {}),
        status: { not: 'Anulada' },
        issueDate: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      _sum: { total: true },
    });
    return rows.map((r) => ({
      estateId: r.estateId,
      supplierId: r.supplierId,
      amount: new Prisma.Decimal(r._sum.total ?? 0),
    }));
  }
  if (basis === 'accrued') {
    const rows = await prisma.$queryRaw<
      { estateId: string; supplierId: string; amount: Prisma.Decimal }[]
    >`
      SELECT i.estate_id AS "estateId", i.supplier_id AS "supplierId", sum(l.debit-l.credit) AS amount
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      JOIN supplier_invoices i ON i.id=e.source_id AND i.estate_id=l.estate_id
      JOIN chart_accounts a ON a.id=l.account_id
      WHERE ${filters(Prisma.sql`l.estate_id`)} AND a.nature::text='expense' AND l.entry_type::text='standard'
        AND e.source_type::text IN ('supplier_invoice','supplier_invoice_cancel')
        ${from ? Prisma.sql`AND l.date >= ${from}::date` : Prisma.empty}
        ${to ? Prisma.sql`AND l.date <= ${to}::date` : Prisma.empty}
        ${supplierId ? Prisma.sql`AND i.supplier_id=${supplierId}::uuid` : Prisma.empty}
      GROUP BY i.estate_id,i.supplier_id`;
    return rows.map((r) => ({ ...r, amount: new Prisma.Decimal(r.amount) }));
  }
  const rows = await prisma.$queryRaw<
    { estateId: string; supplierId: string; amount: Prisma.Decimal }[]
  >`
    SELECT p.estate_id AS "estateId",p.supplier_id AS "supplierId",
      sum(CASE WHEN e.id=p.entry_id THEN p.amount ELSE -p.amount END) AS amount
    FROM supplier_payments p JOIN journal_entries e ON e.id=p.entry_id OR e.id=p.undo_entry_id
    WHERE ${filters(Prisma.sql`p.estate_id`)}
      ${from ? Prisma.sql`AND e.date >= ${from}::date` : Prisma.empty}
      ${to ? Prisma.sql`AND e.date <= ${to}::date` : Prisma.empty}
      ${supplierId ? Prisma.sql`AND p.supplier_id=${supplierId}::uuid` : Prisma.empty}
    GROUP BY p.estate_id,p.supplier_id`;
  return rows.map((r) => ({ ...r, amount: new Prisma.Decimal(r.amount) }));
}
