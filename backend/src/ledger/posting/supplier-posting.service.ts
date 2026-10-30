import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  PayMethod,
  Prisma,
  SupplierInvoice,
  SupplierPayment,
  WithholdingKey,
} from '../../prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalService } from '../journal/journal.service';
import { ensureDefaultBankAccount } from '../chart/ledger-bootstrap';
import { fromCents, toCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';
import type { LineDraft } from './posting.types';
import { collectionAccountRole } from './rules/receipt.rules';
import {
  allocatePayment,
  computeInvoice,
  invoiceStatusFor,
  type InvoiceLineInput,
  type OpenInvoice,
} from './rules/supplier.rules';

type Db = Prisma.TransactionClient;

export interface RegisterInvoiceInput {
  estateId: string;
  supplierId: string;
  number: string;
  concept: string;
  issueDate: Date;
  /** Fecha contable. Sin ella, la de la factura. */
  receivedDate?: Date;
  dueDate?: Date | null;
  vatRatePct: number;
  withholdingRatePct: number;
  withholdingKey?: WithholdingKey | null;
  /** 410 en lugar de 400 (ADR, D9). */
  payableRole?: 'suppliers_payable' | 'creditors_payable';
  lines: InvoiceLineInput[];
  createdByUserId?: string;
}

export interface PayInput {
  estateId: string;
  supplierId: string;
  date: Date;
  amount: Cents;
  method: PayMethod;
  bankAccountId?: string | null;
  invoiceIds?: string[];
  notes?: string;
  createdByUserId?: string;
}

const OPEN_STATUSES = ['Registrada', 'Parcial'] as const;

/**
 * Facturas y pagos a proveedores en el diario (fase 7):
 *
 * - **Registrar**: Debe 6xx por línea (base + IVA, con su centro de coste) /
 *   Haber 400 o 410 por lo que se paga, con la factura como partida abierta,
 *   y 4751 por la retención de IRPF.
 * - **Anular**: contraasiento, solo sin pagos.
 * - **Pagar**: Debe 400/410 de cada factura / Haber banco o caja.
 * - **Deshacer un pago**: contraasiento; las facturas vuelven a deber.
 *
 * Las operaciones de un proveedor se serializan bloqueando su fila: dos
 * pagos simultáneos no leen el mismo pendiente. La base de datos verifica
 * al confirmar que cada factura y su partida abierta cuadran.
 */
@Injectable()
export class SupplierPostingService {
  constructor(private readonly journal: JournalService) {}

  async registerInvoice(
    db: Db,
    input: RegisterInvoiceInput,
  ): Promise<SupplierInvoice> {
    const number = input.number.trim();
    if (!number)
      throw new UnprocessableEntityException('Indica el número de la factura.');
    let amounts;
    try {
      amounts = computeInvoice(
        input.lines,
        input.vatRatePct,
        input.withholdingRatePct,
      );
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }
    await this.lockSupplier(db, input.estateId, input.supplierId);
    await this.assertExpenseLines(db, input.estateId, input.lines);

    const duplicate = await db.supplierInvoice.findFirst({
      where: {
        supplierId: input.supplierId,
        number: { equals: number, mode: 'insensitive' },
        status: { not: 'Anulada' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya hay una factura ${number} de este proveedor.`,
      );
    }

    const payableRole = input.payableRole ?? 'suppliers_payable';
    const withholdingKey =
      amounts.withholding > 0
        ? (input.withholdingKey ?? 'G_profesional')
        : null;
    const receivedDate = accountingDay(input.receivedDate ?? input.issueDate);
    const invoiceId = randomUUID();

    const invoice = await db.supplierInvoice.create({
      data: {
        id: invoiceId,
        estateId: input.estateId,
        supplierId: input.supplierId,
        number,
        concept: input.concept.trim().slice(0, 300),
        issueDate: accountingDay(input.issueDate),
        receivedDate,
        dueDate: input.dueDate ? accountingDay(input.dueDate) : null,
        baseAmount: fromCents(amounts.base),
        vatRatePct: input.vatRatePct,
        vatAmount: fromCents(amounts.vat),
        withholdingRatePct: input.withholdingRatePct,
        withholdingAmount: fromCents(amounts.withholding),
        withholdingKey,
        total: fromCents(amounts.total),
        payable: fromCents(amounts.payable),
        payableRole,
        status: 'Registrada',
        outstanding: fromCents(amounts.payable),
        createdByUserId: input.createdByUserId ?? null,
        lines: {
          createMany: {
            data: amounts.lines.map((l, i) => ({
              lineNo: i + 1,
              accountId: l.accountId,
              costCentreId: l.costCentreId ?? null,
              description: l.description?.slice(0, 255) ?? null,
              baseAmount: fromCents(l.base),
              amount: fromCents(l.amount),
            })),
          },
        },
      },
    });

    const lines: LineDraft[] = [
      ...amounts.lines.map((l) => ({
        account: { accountId: l.accountId },
        debit: l.amount,
        costCentreId: l.costCentreId ?? undefined,
        concept: l.description ?? undefined,
      })),
      {
        account: { role: payableRole },
        credit: amounts.payable,
        supplierId: input.supplierId,
        supplierInvoiceId: invoiceId,
      },
    ];
    if (amounts.withholding > 0) {
      lines.push({
        account: { role: 'withholding_payable' },
        credit: amounts.withholding,
        concept: 'Retención IRPF',
      });
    }
    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date: receivedDate,
      sourceType: 'supplier_invoice',
      sourceId: invoiceId,
      concept: `Factura ${number} · ${invoice.concept}`.slice(0, 255),
      reference: number.slice(0, 100),
      createdByUserId: input.createdByUserId,
      lines,
    });
    return db.supplierInvoice.update({
      where: { id: invoiceId },
      data: { entryId: entry.id },
    });
  }

  async cancelInvoice(
    db: Db,
    invoiceId: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<SupplierInvoice> {
    const invoice = await this.lockInvoice(db, invoiceId);
    if (invoice.status === 'Anulada') {
      throw new ConflictException(
        `La factura ${invoice.number} ya está anulada.`,
      );
    }
    if (
      invoice.status !== 'Registrada' ||
      !invoice.outstanding.equals(invoice.payable)
    ) {
      throw new ConflictException(
        `La factura ${invoice.number} tiene pagos: deshazlos antes de anularla.`,
      );
    }
    if (!invoice.entryId) {
      throw new ConflictException(
        `La factura ${invoice.number} no tiene asiento.`,
      );
    }
    const reversal = await this.journal.reverse(db, invoice.entryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept:
        `Anulación de la factura ${invoice.number}: ${opts.reason}`.slice(
          0,
          255,
        ),
      createdByUserId: opts.userId,
    });
    return db.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'Anulada',
        outstanding: fromCents(0),
        cancelEntryId: reversal.id,
        cancelledAt: new Date(),
        cancelledByUserId: opts.userId ?? null,
        cancelReason: opts.reason.slice(0, 255),
      },
    });
  }

  async pay(db: Db, input: PayInput): Promise<SupplierPayment> {
    await this.lockSupplier(db, input.estateId, input.supplierId);
    const open = await db.supplierInvoice.findMany({
      where: {
        supplierId: input.supplierId,
        status: { in: [...OPEN_STATUSES] },
      },
      select: {
        id: true,
        number: true,
        outstanding: true,
        payable: true,
        dueDate: true,
        issueDate: true,
        payableRole: true,
      },
    });
    let allocations;
    try {
      allocations = allocatePayment(
        input.amount,
        open.map((i): OpenInvoice => ({
          ...i,
          outstanding: toCents(i.outstanding),
        })),
        input.invoiceIds,
      );
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }

    const isCash = collectionAccountRole(input.method) === 'cash';
    const bankAccountId = isCash
      ? null
      : (input.bankAccountId ??
        (await ensureDefaultBankAccount(db, input.estateId)));
    const date = accountingDay(input.date);
    const paymentId = randomUUID();
    const byId = new Map(open.map((i) => [i.id, i]));

    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date,
      sourceType: 'supplier_payment',
      sourceId: paymentId,
      concept:
        `Pago de ${allocations.map((a) => `factura ${byId.get(a.invoiceId)!.number}`).join(', ')}`.slice(
          0,
          255,
        ),
      createdByUserId: input.createdByUserId,
      lines: [
        ...allocations.map((a) => ({
          account: { role: byId.get(a.invoiceId)!.payableRole },
          debit: a.amount,
          supplierId: input.supplierId,
          supplierInvoiceId: a.invoiceId,
        })),
        {
          account: isCash
            ? { role: 'cash' as const }
            : { bankAccountId: bankAccountId! },
          credit: input.amount,
        },
      ],
    });

    for (const a of allocations) {
      const inv = byId.get(a.invoiceId)!;
      const outstanding = toCents(inv.outstanding) - a.amount;
      await db.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          outstanding: fromCents(outstanding),
          status: invoiceStatusFor(toCents(inv.payable), outstanding),
        },
      });
    }
    return db.supplierPayment.create({
      data: {
        id: paymentId,
        estateId: input.estateId,
        supplierId: input.supplierId,
        date,
        amount: fromCents(input.amount),
        method: input.method,
        bankAccountId,
        entryId: entry.id,
        notes: input.notes?.slice(0, 255) ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async undoPayment(
    db: Db,
    paymentId: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<SupplierPayment> {
    await db.$queryRaw`SELECT 1 FROM "supplier_payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
    const payment = await db.supplierPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('El pago no existe.');
    if (payment.undoneAt)
      throw new ConflictException('Este pago ya está deshecho.');
    await this.lockSupplier(db, payment.estateId, payment.supplierId);

    const settled = await db.journalLine.findMany({
      where: {
        entryId: payment.entryId,
        supplierInvoiceId: { not: null },
        debit: { gt: 0 },
      },
      select: { supplierInvoiceId: true, debit: true },
    });
    const reversal = await this.journal.reverse(db, payment.entryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept: `Pago deshecho: ${opts.reason}`.slice(0, 255),
      createdByUserId: opts.userId,
    });
    for (const line of settled) {
      const inv = await db.supplierInvoice.findUniqueOrThrow({
        where: { id: line.supplierInvoiceId! },
      });
      const outstanding = toCents(inv.outstanding) + toCents(line.debit);
      await db.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          outstanding: fromCents(outstanding),
          status: invoiceStatusFor(toCents(inv.payable), outstanding),
        },
      });
    }
    return db.supplierPayment.update({
      where: { id: payment.id },
      data: {
        undoneAt: new Date(),
        undoneByUserId: opts.userId ?? null,
        undoReason: opts.reason.slice(0, 255),
        undoEntryId: reversal.id,
      },
    });
  }

  // ── Ayudas ──────────────────────────────────────────────────────────────

  private async lockSupplier(
    db: Db,
    estateId: string,
    supplierId: string,
  ): Promise<void> {
    const rows = await db.$queryRaw<{ estateId: string }[]>`
      SELECT "estateId" FROM "suppliers" WHERE "id" = ${supplierId}::uuid FOR UPDATE
    `;
    if (rows.length === 0 || rows[0].estateId !== estateId) {
      throw new NotFoundException('El proveedor no existe en esta finca.');
    }
  }

  private async lockInvoice(
    db: Db,
    invoiceId: string,
  ): Promise<SupplierInvoice> {
    await db.$queryRaw`SELECT 1 FROM "supplier_invoices" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await db.supplierInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('La factura no existe.');
    return invoice;
  }

  /** Cada línea va a una cuenta de gasto (grupo 6) de la finca, con un centro de coste de la finca. */
  private async assertExpenseLines(
    db: Db,
    estateId: string,
    lines: InvoiceLineInput[],
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await db.chartAccount.findMany({
      where: { id: { in: accountIds }, estateId },
      select: { id: true, code: true, postable: true, archivedAt: true },
    });
    for (const id of accountIds) {
      const a = accounts.find((x) => x.id === id);
      if (!a)
        throw new UnprocessableEntityException(
          'Una línea usa una cuenta que no es de esta finca.',
        );
      if (!a.code.startsWith('6')) {
        throw new UnprocessableEntityException(
          `La cuenta ${a.code} no es de gastos (grupo 6).`,
        );
      }
      if (!a.postable || a.archivedAt) {
        throw new UnprocessableEntityException(
          `La cuenta ${a.code} no admite apuntes.`,
        );
      }
    }
    const centreIds = [
      ...new Set(
        lines.map((l) => l.costCentreId).filter((v): v is string => Boolean(v)),
      ),
    ];
    if (centreIds.length > 0) {
      const found = await db.costCentre.count({
        where: { id: { in: centreIds }, estateId },
      });
      if (found !== centreIds.length) {
        throw new UnprocessableEntityException(
          'Una línea usa un centro de coste que no es de esta finca.',
        );
      }
    }
  }
}
