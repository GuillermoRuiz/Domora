import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { runPosting } from '../journal/journal-db-errors';
import { CollectionPostingService } from '../posting/collection-posting.service';
import { fromCents, toCents } from '../money';
import type {
  ApplyAdvanceDto,
  ApplySuspenseDto,
  CreateCollectionDto,
  CreateSuspenseDto,
  ListCollectionsQuery,
  ReturnCollectionDto,
  UndoCollectionDto,
} from './collections.dto';

const OPEN_STATUSES = ['Pendiente', 'Parcial', 'Devuelto'] as const;

/** 'AAAA-MM-DD' → medianoche UTC (las fechas contables son días, no instantes). */
function day(iso: string | undefined): Date {
  if (!iso) return new Date();
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function euros(cents: number): number {
  return Number(fromCents(cents));
}

/**
 * Casos de uso de cobros sobre `CollectionPostingService`: control de
 * acceso, conversión de euros a céntimos, transacción y lecturas para la
 * interfaz (listados, historial de un recibo, cuenta de una propiedad).
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly collections: CollectionPostingService,
  ) {}

  // ── Cobros ──────────────────────────────────────────────────────────────

  async list(
    estateId: string,
    query: ListCollectionsQuery,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const where: Prisma.CollectionWhereInput = {
      estateId,
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: day(query.from) } : {}),
              ...(query.to ? { lte: day(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.collection.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        bankAccount: { select: { alias: true } },
        returnRecord: {
          select: { id: true, date: true, returnCode: true, feeAmount: true },
        },
        remesaLine: { select: { remesaId: true } },
        entry: { select: { number: true, fiscalYear: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      propertyId: c.propertyId,
      date: c.date,
      amount: Number(c.amount),
      method: c.method,
      bankAccountId: c.bankAccountId,
      bankAccountAlias: c.bankAccount?.alias ?? null,
      remesaId: c.remesaLine?.remesaId ?? null,
      suspenseItemId: c.suspenseItemId,
      notes: c.notes,
      entryNumber: c.entry.number,
      fiscalYear: c.entry.fiscalYear,
      status: c.undoneAt ? 'Anulado' : c.returnRecord ? 'Devuelto' : 'Vigente',
      undoneAt: c.undoneAt,
      undoReason: c.undoReason,
      returnDate: c.returnRecord?.date ?? null,
      returnCode: c.returnRecord?.returnCode ?? null,
      returnFee: c.returnRecord?.feeAmount
        ? Number(c.returnRecord.feeAmount)
        : null,
    }));
  }

  async create(
    estateId: string,
    dto: CreateCollectionDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertBankAccount(estateId, dto.bankAccountId);
    return runPosting(this.prisma, (tx) =>
      this.collections.collect(tx, {
        estateId,
        propertyId: dto.propertyId,
        date: day(dto.date),
        amount: toCents(dto.amount),
        method: dto.method,
        bankAccountId: dto.bankAccountId ?? null,
        receiptIds: dto.receiptIds,
        notes: dto.notes,
        createdByUserId: user.id,
      }),
    );
  }

  async undo(
    collectionId: string,
    dto: UndoCollectionDto,
    user: AuthenticatedUser,
  ) {
    await this.findOwnCollection(collectionId, user);
    return runPosting(this.prisma, (tx) =>
      this.collections.undo(tx, collectionId, {
        reason: dto.reason,
        date: dto.date ? day(dto.date) : undefined,
        userId: user.id,
      }),
    );
  }

  async returnCollection(
    collectionId: string,
    dto: ReturnCollectionDto,
    user: AuthenticatedUser,
  ) {
    await this.findOwnCollection(collectionId, user);
    return runPosting(this.prisma, (tx) =>
      this.collections.returnCollection(tx, collectionId, {
        date: day(dto.date),
        returnCode: dto.returnCode ?? null,
        returnReason: dto.returnReason ?? null,
        feeAmount: dto.feeAmount ? toCents(dto.feeAmount) : 0,
        rechargeFee: dto.rechargeFee ?? false,
        source: 'manual',
        userId: user.id,
      }),
    );
  }

  // ── Anticipos ───────────────────────────────────────────────────────────

  async applyAdvance(
    estateId: string,
    dto: ApplyAdvanceDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const result = await runPosting(this.prisma, (tx) =>
      this.collections.applyAdvance(tx, {
        estateId,
        propertyId: dto.propertyId,
        date: day(dto.date),
        receiptIds: dto.receiptIds,
        userId: user.id,
      }),
    );
    return {
      applied: euros(result.applied),
      allocations: result.allocations.map((a) => ({
        receiptId: a.receiptId,
        amount: euros(a.amount),
      })),
    };
  }

  /** Lo que debe una propiedad (recibos abiertos) y lo que tiene a favor (anticipo). */
  async propertyAccount(
    estateId: string,
    propertyId: string,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, estateId },
      select: { id: true },
    });
    if (!property)
      throw new NotFoundException('La propiedad no existe en esta finca.');
    const [receipts, advance] = await Promise.all([
      this.prisma.accountingReceipt.findMany({
        where: { propertyId, status: { in: [...OPEN_STATUSES] } },
        orderBy: [{ originYear: 'asc' }, { accrualDate: 'asc' }, { no: 'asc' }],
        select: {
          id: true,
          no: true,
          kind: true,
          concept: true,
          amount: true,
          outstanding: true,
          status: true,
          dueDate: true,
          originYear: true,
        },
      }),
      this.prisma.$transaction((tx) =>
        this.collections.availableAdvance(tx, propertyId),
      ),
    ]);
    const pending = receipts.reduce((s, r) => s + toCents(r.outstanding), 0);
    return {
      propertyId,
      pending: euros(pending),
      advance: euros(advance),
      balance: euros(pending - advance),
      openReceipts: receipts.map((r) => ({
        ...r,
        amount: Number(r.amount),
        outstanding: Number(r.outstanding),
      })),
    };
  }

  // ── Ingresos sin identificar ────────────────────────────────────────────

  async listSuspense(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const items = await this.prisma.suspenseItem.findMany({
      where: { estateId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        bankAccount: { select: { alias: true } },
        applications: {
          where: { undoneAt: null },
          select: { id: true, propertyId: true, amount: true, date: true },
        },
      },
    });
    return items.map((i) => {
      const applied = i.applications.reduce((s, a) => s + toCents(a.amount), 0);
      return {
        id: i.id,
        date: i.date,
        amount: Number(i.amount),
        concept: i.concept,
        bankAccountId: i.bankAccountId,
        bankAccountAlias: i.bankAccount.alias,
        applied: euros(applied),
        remaining: euros(toCents(i.amount) - applied),
        applications: i.applications.map((a) => ({
          ...a,
          amount: Number(a.amount),
        })),
      };
    });
  }

  async registerSuspense(
    estateId: string,
    dto: CreateSuspenseDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertBankAccount(estateId, dto.bankAccountId);
    return runPosting(this.prisma, (tx) =>
      this.collections.registerSuspense(tx, {
        estateId,
        date: day(dto.date),
        amount: toCents(dto.amount),
        concept: dto.concept,
        bankAccountId: dto.bankAccountId ?? null,
        userId: user.id,
      }),
    );
  }

  async applySuspense(
    suspenseItemId: string,
    dto: ApplySuspenseDto,
    user: AuthenticatedUser,
  ) {
    const item = await this.prisma.suspenseItem.findUnique({
      where: { id: suspenseItemId },
      select: { estateId: true },
    });
    if (!item)
      throw new NotFoundException('El ingreso sin identificar no existe.');
    this.estateAccess.assertAccess(item.estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.collections.applySuspense(tx, {
        suspenseItemId,
        propertyId: dto.propertyId,
        amount: toCents(dto.amount),
        date: day(dto.date),
        receiptIds: dto.receiptIds,
        userId: user.id,
      }),
    );
  }

  // ── Historial de un recibo ──────────────────────────────────────────────

  /**
   * Movimientos de la partida abierta de un recibo (su 430): emisión,
   * cobros, devoluciones, anulaciones. El saldo final es lo que queda por
   * cobrar. El propietario (rol C) solo ve los suyos.
   */
  async receiptHistory(receiptId: string, user: AuthenticatedUser) {
    const receipt = await this.prisma.accountingReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        no: true,
        estateId: true,
        ownerUserId: true,
        amount: true,
        outstanding: true,
        status: true,
      },
    });
    if (!receipt)
      throw new NotFoundException(`Recibo ${receiptId} no encontrado.`);
    this.estateAccess.assertAccess(receipt.estateId, user);
    if (user.role === 'C' && receipt.ownerUserId !== user.id) {
      throw new ForbiddenException(
        'Solo el propietario del recibo puede ver su historial.',
      );
    }

    const lines = await this.prisma.journalLine.findMany({
      where: { receiptId },
      orderBy: [
        { date: 'asc' },
        { entry: { number: 'asc' } },
        { lineNo: 'asc' },
      ],
      select: {
        debit: true,
        credit: true,
        date: true,
        entryId: true,
        entry: {
          select: {
            number: true,
            fiscalYear: true,
            sourceType: true,
            concept: true,
          },
        },
      },
    });
    const entryIds = [...new Set(lines.map((l) => l.entryId))];
    const [collections, returns] = await Promise.all([
      this.prisma.collection.findMany({
        where: {
          OR: [
            { entryId: { in: entryIds } },
            { undoEntryId: { in: entryIds } },
          ],
          AND: [
            { OR: [{ remesaLineId: null }, { remesaLine: { receiptId } }] },
          ],
        },
        select: {
          id: true,
          entryId: true,
          undoEntryId: true,
          method: true,
          undoneAt: true,
          remesaLineId: true,
          returnRecord: { select: { id: true } },
        },
      }),
      this.prisma.receiptReturn.findMany({
        where: { entryId: { in: entryIds } },
        select: {
          entryId: true,
          collectionId: true,
          returnCode: true,
          returnReason: true,
          feeAmount: true,
        },
      }),
    ]);
    const byEntry = new Map(collections.map((c) => [c.entryId, c]));
    const byUndo = new Map(
      collections.filter((c) => c.undoEntryId).map((c) => [c.undoEntryId!, c]),
    );
    const byReturn = new Map(returns.map((r) => [r.entryId, r]));

    let balance = 0;
    const movements = lines.map((l) => {
      balance += toCents(l.debit) - toCents(l.credit);
      const collection = byEntry.get(l.entryId);
      const undone = byUndo.get(l.entryId);
      const ret = byReturn.get(l.entryId);
      const isManager = user.role !== 'C';
      return {
        date: l.date,
        entryNumber: l.entry.number,
        fiscalYear: l.entry.fiscalYear,
        sourceType: l.entry.sourceType,
        concept: l.entry.concept,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: euros(balance),
        method: collection?.method ?? null,
        returnCode: ret?.returnCode ?? null,
        returnReason: ret?.returnReason ?? null,
        // Solo gestión puede actuar sobre el cobro (deshacer, devolver).
        collectionId: isManager
          ? (collection?.id ?? ret?.collectionId ?? undone?.id ?? null)
          : null,
        collectionActive:
          isManager && collection
            ? !collection.undoneAt && !collection.returnRecord
            : false,
        // Un cobro de remesa se devuelve desde la remesa (y no se deshace).
        fromRemesa: Boolean(collection?.remesaLineId),
      };
    });
    return {
      receiptId: receipt.id,
      no: receipt.no,
      amount: Number(receipt.amount),
      outstanding: Number(receipt.outstanding),
      status: receipt.status,
      movements,
    };
  }

  // ── Ayudas ──────────────────────────────────────────────────────────────

  private async findOwnCollection(
    collectionId: string,
    user: AuthenticatedUser,
  ) {
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true, estateId: true },
    });
    if (!collection) throw new NotFoundException('El cobro no existe.');
    this.estateAccess.assertAccess(collection.estateId, user);
    return collection;
  }

  /** Un banco indicado por el cliente debe ser de la finca y estar abierto. */
  private async assertBankAccount(
    estateId: string,
    bankAccountId: string | undefined,
  ) {
    if (!bankAccountId) return;
    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, estateId, closedAt: null },
      select: { id: true },
    });
    if (!bank)
      throw new NotFoundException(
        'La cuenta bancaria no existe en esta finca o está cerrada.',
      );
  }
}
