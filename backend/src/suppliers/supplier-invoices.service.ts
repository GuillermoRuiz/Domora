import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SupplierInvoiceStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { SupplierPostingService } from '../ledger/posting/supplier-posting.service';
import { toCents, fromCents } from '../ledger/money';
import type { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import type {
  CancelSupplierInvoiceDto,
  UpdateSupplierInvoiceDto,
} from './dto/update-supplier-invoice.dto';
import type {
  CreateSupplierPaymentDto,
  UndoSupplierPaymentDto,
} from './dto/supplier-payment.dto';

/** 'AAAA-MM-DD' → medianoche UTC. */
function day(iso: string | undefined): Date {
  if (!iso) return new Date();
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

const INVOICE_INCLUDE = {
  supplier: { select: { id: true, name: true, taxId: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { code: true, name: true } },
      costCentre: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.SupplierInvoiceInclude;

type InvoiceRow = Prisma.SupplierInvoiceGetPayload<{
  include: typeof INVOICE_INCLUDE;
}>;

function invoiceView(i: InvoiceRow) {
  return {
    id: i.id,
    supplierId: i.supplierId,
    supplierName: i.supplier.name,
    number: i.number,
    concept: i.concept,
    issueDate: i.issueDate,
    receivedDate: i.receivedDate,
    dueDate: i.dueDate,
    baseAmount: Number(i.baseAmount),
    vatRatePct: Number(i.vatRatePct),
    vatAmount: Number(i.vatAmount),
    withholdingRatePct: Number(i.withholdingRatePct),
    withholdingAmount: Number(i.withholdingAmount),
    withholdingKey: i.withholdingKey,
    total: Number(i.total),
    payable: Number(i.payable),
    payableAccount: i.payableRole === 'creditors_payable' ? '410' : '400',
    status: i.status,
    outstanding: Number(i.outstanding),
    cancelledAt: i.cancelledAt,
    cancelReason: i.cancelReason,
    fileName: i.fileName,
    lines: i.lines.map((l) => ({
      lineNo: l.lineNo,
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      costCentreId: l.costCentreId,
      costCentreName: l.costCentre?.name ?? null,
      description: l.description,
      baseAmount: Number(l.baseAmount),
      amount: Number(l.amount),
    })),
  };
}

/**
 * Casos de uso de facturas y pagos a proveedores sobre
 * `SupplierPostingService`: acceso, euros → céntimos, transacción, y
 * lecturas para la interfaz (facturas, pendientes de pago, pagos y el mayor
 * del proveedor).
 */
@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly posting: SupplierPostingService,
  ) {}

  // ── Facturas ────────────────────────────────────────────────────────────

  async listForSupplier(
    estateId: string,
    supplierId: string,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplier(estateId, supplierId);
    const rows = await this.prisma.supplierInvoice.findMany({
      where: { supplierId },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      include: INVOICE_INCLUDE,
    });
    return rows.map(invoiceView);
  }

  /** Facturas de la finca: las pendientes de pago (por defecto) o todas. */
  async listForEstate(
    estateId: string,
    opts: { onlyOpen?: boolean },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const status: SupplierInvoiceStatus[] | undefined =
      opts.onlyOpen === false ? undefined : ['Registrada', 'Parcial'];
    const rows = await this.prisma.supplierInvoice.findMany({
      where: { estateId, ...(status ? { status: { in: status } } : {}) },
      orderBy: [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { issueDate: 'asc' },
      ],
      include: INVOICE_INCLUDE,
      take: 1000,
    });
    return rows.map(invoiceView);
  }

  async create(
    estateId: string,
    supplierId: string,
    dto: CreateSupplierInvoiceDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const invoice = await runPosting(this.prisma, (tx) =>
      this.posting.registerInvoice(tx, {
        estateId,
        supplierId,
        number: dto.number,
        concept: dto.concept,
        issueDate: day(dto.issueDate),
        receivedDate: dto.receivedDate ? day(dto.receivedDate) : undefined,
        dueDate: dto.dueDate ? day(dto.dueDate) : null,
        vatRatePct: dto.vatRatePct,
        withholdingRatePct: dto.withholdingRatePct,
        withholdingKey: dto.withholdingKey ?? null,
        payableRole:
          dto.payableAccount === '410'
            ? 'creditors_payable'
            : 'suppliers_payable',
        lines: dto.lines.map((l) => ({
          accountId: l.accountId,
          costCentreId: l.costCentreId ?? null,
          description: l.description ?? null,
          base: toCents(l.baseAmount),
        })),
        createdByUserId: user.id,
      }),
    );
    return this.view(invoice.id);
  }

  async updateDueDate(
    estateId: string,
    supplierId: string,
    invoiceId: string,
    dto: UpdateSupplierInvoiceDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertInvoice(estateId, supplierId, invoiceId);
    if (dto.dueDate !== undefined) {
      await this.prisma.supplierInvoice.update({
        where: { id: invoiceId },
        data: { dueDate: dto.dueDate === null ? null : day(dto.dueDate) },
      });
    }
    return this.view(invoiceId);
  }

  async cancel(
    estateId: string,
    supplierId: string,
    invoiceId: string,
    dto: CancelSupplierInvoiceDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertInvoice(estateId, supplierId, invoiceId);
    await runPosting(this.prisma, (tx) =>
      this.posting.cancelInvoice(tx, invoiceId, {
        reason: dto.reason,
        userId: user.id,
      }),
    );
    return this.view(invoiceId);
  }

  // ── Pagos ───────────────────────────────────────────────────────────────

  async listPayments(
    estateId: string,
    opts: { supplierId?: string },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const rows = await this.prisma.supplierPayment.findMany({
      where: {
        estateId,
        ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        supplier: { select: { name: true } },
        bankAccount: { select: { alias: true } },
        entry: {
          select: {
            number: true,
            fiscalYear: true,
            lines: {
              where: { supplierInvoiceId: { not: null }, debit: { gt: 0 } },
              select: {
                debit: true,
                supplierInvoice: { select: { id: true, number: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      supplierId: p.supplierId,
      supplierName: p.supplier.name,
      date: p.date,
      amount: Number(p.amount),
      method: p.method,
      bankAccountAlias: p.bankAccount?.alias ?? null,
      notes: p.notes,
      entryNumber: p.entry.number,
      fiscalYear: p.entry.fiscalYear,
      status: p.undoneAt ? 'Deshecho' : 'Vigente',
      undoneAt: p.undoneAt,
      undoReason: p.undoReason,
      invoices: p.entry.lines.map((l) => ({
        invoiceId: l.supplierInvoice!.id,
        number: l.supplierInvoice!.number,
        amount: Number(l.debit),
      })),
    }));
  }

  async pay(
    estateId: string,
    dto: CreateSupplierPaymentDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({
        where: { id: dto.bankAccountId, estateId, closedAt: null },
        select: { id: true },
      });
      if (!bank)
        throw new NotFoundException(
          'La cuenta bancaria no existe en esta finca o está cerrada.',
        );
    }
    return runPosting(this.prisma, (tx) =>
      this.posting.pay(tx, {
        estateId,
        supplierId: dto.supplierId,
        date: day(dto.date),
        amount: toCents(dto.amount),
        method: dto.method,
        bankAccountId: dto.bankAccountId ?? null,
        invoiceIds: dto.invoiceIds,
        notes: dto.notes,
        createdByUserId: user.id,
      }),
    );
  }

  async undoPayment(
    paymentId: string,
    dto: UndoSupplierPaymentDto,
    user: AuthenticatedUser,
  ) {
    const payment = await this.prisma.supplierPayment.findUnique({
      where: { id: paymentId },
      select: { estateId: true },
    });
    if (!payment) throw new NotFoundException('El pago no existe.');
    this.estateAccess.assertAccess(payment.estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.posting.undoPayment(tx, paymentId, {
        reason: dto.reason,
        userId: user.id,
      }),
    );
  }

  // ── Mayor del proveedor ─────────────────────────────────────────────────

  /**
   * Apuntes del proveedor en la 400/410: facturas (haber), pagos (debe),
   * anulaciones y pagos deshechos. El saldo es lo que la comunidad le debe.
   */
  async ledger(estateId: string, supplierId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplier(estateId, supplierId);
    const lines = await this.prisma.journalLine.findMany({
      where: { supplierId, account: { requiresSupplier: true } },
      orderBy: [
        { date: 'asc' },
        { entry: { number: 'asc' } },
        { lineNo: 'asc' },
      ],
      select: {
        date: true,
        debit: true,
        credit: true,
        account: { select: { code: true } },
        supplierInvoice: { select: { id: true, number: true } },
        entry: {
          select: {
            id: true,
            number: true,
            fiscalYear: true,
            sourceType: true,
            concept: true,
          },
        },
      },
    });
    let balance = 0;
    const movements = lines.map((l) => {
      balance += toCents(l.credit) - toCents(l.debit);
      return {
        date: l.date,
        entryNumber: l.entry.number,
        fiscalYear: l.entry.fiscalYear,
        sourceType: l.entry.sourceType,
        concept: l.entry.concept,
        accountCode: l.account.code,
        invoiceNumber: l.supplierInvoice?.number ?? null,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: Number(fromCents(balance)),
      };
    });
    return { supplierId, balance: Number(fromCents(balance)), movements };
  }

  // ── Ayudas ──────────────────────────────────────────────────────────────

  private async view(invoiceId: string) {
    return invoiceView(
      await this.prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: INVOICE_INCLUDE,
      }),
    );
  }

  private async assertSupplier(
    estateId: string,
    supplierId: string,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { estateId: true },
    });
    if (!supplier || supplier.estateId !== estateId) {
      throw new NotFoundException('Proveedor no encontrado en esta finca.');
    }
  }

  private async assertInvoice(
    estateId: string,
    supplierId: string,
    invoiceId: string,
  ): Promise<void> {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: { supplierId: true, estateId: true },
    });
    if (
      !invoice ||
      invoice.supplierId !== supplierId ||
      invoice.estateId !== estateId
    ) {
      throw new NotFoundException('Factura no encontrada para este proveedor.');
    }
  }
}
