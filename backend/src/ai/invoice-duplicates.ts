import type { Prisma } from '../prisma/client';
import type { InvoiceExtraction } from './ai.types';
export async function existingInvoiceIds(
  tx: Prisma.TransactionClient,
  estateId: string,
  value: InvoiceExtraction,
): Promise<string[]> {
  if (!value.supplier_tax_id || !value.invoice_number) return [];
  const existing = await tx.supplierInvoice.findMany({
    where: {
      estateId,
      number: value.invoice_number,
      cancelledAt: null,
      supplier: {
        estateId,
        taxId: { equals: value.supplier_tax_id, mode: 'insensitive' },
      },
    },
    select: { id: true },
    take: 20,
  });
  return existing.map((x) => x.id);
}
