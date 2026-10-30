import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  Collection,
  PayMethod,
  Prisma,
  ReceiptStatus,
} from '../../prisma/client';
import { ensureDefaultBankAccount } from '../chart/ledger-bootstrap';
import { JournalService } from '../journal/journal.service';
import { fromCents, toCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';
import type { LineDraft } from './posting.types';
import { ReceiptPostingService } from './receipt-posting.service';
import {
  allocateCollection,
  receiptStatusFor,
  type Allocation,
  type OpenReceipt,
} from './rules/collection.rules';
import { collectionAccountRole } from './rules/receipt.rules';

type Db = Prisma.TransactionClient;

const OPEN_STATUSES: ReceiptStatus[] = ['Pendiente', 'Parcial', 'Devuelto'];

export interface CollectInput {
  estateId: string;
  propertyId: string;
  date: Date;
  amount: Cents;
  method: PayMethod;
  /** Banco de destino. Sin él: el banco por defecto (o la caja si es en efectivo). */
  bankAccountId?: string | null;
  /** Recibos a los que imputar, en ese orden. Sin ellos: orden legal (intereses, lo más antiguo). */
  receiptIds?: string[];
  notes?: string;
  createdByUserId?: string;
}

/**
 * Dinero que entra y sale por la cuenta de propietarios (430): cobros,
 * devoluciones, anticipos, ingresos sin identificar y cobro de remesas.
 * Cada operación deja los recibos y su partida abierta cuadrados en la
 * misma transacción (la base de datos lo verifica al confirmar).
 *
 * Las operaciones de una propiedad se serializan bloqueando su fila: dos
 * cobros o aplicaciones de anticipo simultáneos no leen el mismo saldo.
 */
@Injectable()
export class CollectionPostingService {
  constructor(
    private readonly journal: JournalService,
    private readonly receipts: ReceiptPostingService,
  ) {}

  // ── Cobro manual ─────────────────────────────────────────────────────────

  async collect(db: Db, input: CollectInput): Promise<Collection> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new UnprocessableEntityException(
        'El importe del cobro debe ser mayor que cero.',
      );
    }
    await this.lockProperty(db, input.estateId, input.propertyId);
    const open = await this.openReceipts(db, input.propertyId);
    const { allocations, advance } = this.allocate(
      input.amount,
      open,
      input.receiptIds,
    );

    const isCash = collectionAccountRole(input.method) === 'cash';
    const bankAccountId = isCash
      ? null
      : (input.bankAccountId ??
        (await ensureDefaultBankAccount(db, input.estateId)));
    const collectionId = randomUUID();
    const date = accountingDay(input.date);

    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date,
      sourceType: 'collection',
      sourceId: collectionId,
      concept: this.collectionConcept(open, allocations, advance),
      createdByUserId: input.createdByUserId,
      lines: [
        {
          account: isCash
            ? { role: 'cash' }
            : { bankAccountId: bankAccountId! },
          debit: input.amount,
        },
        ...this.receivableCredits(input.propertyId, allocations, advance),
      ],
    });

    await this.applyToReceipts(db, open, allocations);
    return db.collection.create({
      data: {
        id: collectionId,
        estateId: input.estateId,
        propertyId: input.propertyId,
        date,
        amount: fromCents(input.amount),
        method: input.method,
        bankAccountId,
        entryId: entry.id,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  /**
   * Deshace un cobro registrado por error: contraasiento, y los recibos
   * vuelven a deber lo que pagaba. No vale para una línea de remesa (su
   * asiento es común a toda la remesa: eso es una devolución) ni para un
   * cobro ya devuelto. Si su anticipo ya se aplicó a otros recibos, hay que
   * deshacer antes esa aplicación.
   */
  async undo(
    db: Db,
    collectionId: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<Collection> {
    const collection = await this.loadActiveCollection(db, collectionId);
    if (collection.remesaLineId) {
      throw new ConflictException(
        'Este cobro es de una remesa: si el banco lo devolvió, registra la devolución.',
      );
    }
    await this.lockProperty(db, collection.estateId, collection.propertyId);
    const { allocations, advance } = await this.creditsOf(db, collection);
    await this.assertAdvanceAvailable(db, collection.propertyId, advance);

    const reversal = await this.journal.reverse(db, collection.entryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept:
        `Anulación del cobro del ${collection.date.toISOString().slice(0, 10)}: ${opts.reason}`.slice(
          0,
          255,
        ),
      createdByUserId: opts.userId,
    });
    await this.reopenReceipts(db, allocations, { returned: false });
    return db.collection.update({
      where: { id: collection.id },
      data: {
        undoneAt: new Date(),
        undoneByUserId: opts.userId ?? null,
        undoReason: opts.reason.slice(0, 255),
        undoEntryId: reversal.id,
      },
    });
  }

  /**
   * Devolución bancaria de un cobro: el banco devuelve el dinero. Debe 430
   * de los recibos que pagaba (vuelven a deber) / Haber banco; la comisión
   * va a la 626 y, si se repercute, se emite un recibo de gastos de
   * devolución al propietario (ADR, D8).
   */
  async returnCollection(
    db: Db,
    collectionId: string,
    opts: {
      date: Date;
      returnCode?: string | null;
      returnReason?: string | null;
      feeAmount?: Cents;
      rechargeFee?: boolean;
      source?: 'manual' | 'pain002' | 'camt054' | 'n19';
      userId?: string;
    },
  ) {
    const collection = await this.loadActiveCollection(db, collectionId);
    if (!collection.bankAccountId) {
      throw new ConflictException(
        'Un cobro en efectivo no se devuelve: si fue un error, deshazlo.',
      );
    }
    await this.lockProperty(db, collection.estateId, collection.propertyId);
    const { allocations, advance } = await this.creditsOf(db, collection);
    await this.assertAdvanceAvailable(db, collection.propertyId, advance);

    const amount = toCents(collection.amount);
    const fee = opts.feeAmount ?? 0;
    if (!Number.isSafeInteger(fee) || fee < 0) {
      throw new UnprocessableEntityException(
        'La comisión de devolución no es válida.',
      );
    }
    const date = accountingDay(opts.date);
    const lines: LineDraft[] = [
      ...allocations.map((a) => ({
        account: { role: 'owners_receivable' as const },
        debit: a.amount,
        propertyId: collection.propertyId,
        receiptId: a.receiptId,
      })),
      ...(advance > 0
        ? [
            {
              account: { role: 'owners_receivable' as const },
              debit: advance,
              propertyId: collection.propertyId,
            },
          ]
        : []),
      { account: { bankAccountId: collection.bankAccountId }, credit: amount },
    ];
    if (fee > 0) {
      lines.push(
        {
          account: { role: 'bank_fees' },
          debit: fee,
          concept: 'Comisión por devolución',
        },
        {
          account: { bankAccountId: collection.bankAccountId },
          credit: fee,
          concept: 'Comisión por devolución',
        },
      );
    }
    const entry = await this.journal.post(db, {
      estateId: collection.estateId,
      date,
      sourceType: 'receipt_return',
      sourceId: collection.id,
      concept:
        `Devolución bancaria${opts.returnCode ? ` ${opts.returnCode}` : ''}${opts.returnReason ? ` · ${opts.returnReason}` : ''}`.slice(
          0,
          255,
        ),
      createdByUserId: opts.userId,
      lines,
    });
    await this.reopenReceipts(db, allocations, {
      returned: true,
      returnCode: opts.returnCode ?? null,
      returnReason: opts.returnReason ?? null,
    });

    let feeRechargedReceiptId: string | null = null;
    if (fee > 0 && opts.rechargeFee) {
      feeRechargedReceiptId = await this.rechargeReturnFee(
        db,
        collection,
        fee,
        date,
        opts.userId,
      );
    }

    return db.receiptReturn.create({
      data: {
        estateId: collection.estateId,
        collectionId: collection.id,
        remesaLineId: collection.remesaLineId,
        date,
        amount: collection.amount,
        returnCode: opts.returnCode ?? null,
        returnReason: opts.returnReason ?? null,
        feeAmount: fee > 0 ? fromCents(fee) : null,
        feeRechargedReceiptId,
        entryId: entry.id,
        source: opts.source ?? 'manual',
        createdByUserId: opts.userId ?? null,
      },
    });
  }

  /**
   * Cobros vivos (ni deshechos ni devueltos) que imputaron algo a este
   * recibo, el más reciente primero. En una remesa el asiento es común a
   * todas las líneas: solo cuenta la línea de este recibo.
   */
  activeCollectionsFor(db: Db, receiptId: string) {
    return db.collection.findMany({
      where: {
        undoneAt: null,
        returnRecord: null,
        entry: { lines: { some: { receiptId, credit: { gt: 0 } } } },
        OR: [{ remesaLineId: null }, { remesaLine: { receiptId } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** ¿El cobro imputa exactamente a este recibo y a nada más (sin anticipo)? */
  async coversOnly(
    db: Db,
    collection: Collection,
    receiptId: string,
  ): Promise<boolean> {
    const { allocations, advance } = await this.creditsOf(db, collection);
    return (
      advance === 0 &&
      allocations.length === 1 &&
      allocations[0].receiptId === receiptId
    );
  }

  // ── Anticipos ────────────────────────────────────────────────────────────

  /** Anticipo disponible de una propiedad (saldo acreedor de su 430 sin recibo), en céntimos. */
  async availableAdvance(db: Db, propertyId: string): Promise<Cents> {
    const rows = await db.$queryRaw<{ balance: Prisma.Decimal | null }[]>`
      SELECT sum(jl."credit" - jl."debit") AS balance
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE jl."property_id" = ${propertyId}::uuid
         AND jl."receipt_id" IS NULL
         AND a."system_role" = 'owners_receivable'
    `;
    return rows[0]?.balance ? toCents(rows[0].balance) : 0;
  }

  /** Igual que `availableAdvance`, pero para todas las propiedades de una finca de una vez (morosidad). */
  async availableAdvancesByEstate(
    db: Db,
    estateId: string,
  ): Promise<Map<string, Cents>> {
    const rows = await db.$queryRaw<
      { propertyId: string; balance: Prisma.Decimal }[]
    >`
      SELECT jl."property_id" AS "propertyId", sum(jl."credit" - jl."debit") AS balance
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE jl."estate_id" = ${estateId}::uuid
         AND jl."property_id" IS NOT NULL
         AND jl."receipt_id" IS NULL
         AND a."system_role" = 'owners_receivable'
       GROUP BY jl."property_id"
      HAVING sum(jl."credit" - jl."debit") > 0
    `;
    return new Map(rows.map((r) => [r.propertyId, toCents(r.balance)]));
  }

  /** Aplica el anticipo de una propiedad a sus recibos pendientes. */
  async applyAdvance(
    db: Db,
    input: {
      estateId: string;
      propertyId: string;
      date: Date;
      receiptIds?: string[];
      userId?: string;
    },
  ): Promise<{ applied: Cents; allocations: Allocation[] }> {
    await this.lockProperty(db, input.estateId, input.propertyId);
    const available = await this.availableAdvance(db, input.propertyId);
    if (available <= 0) {
      throw new ConflictException(
        'Esta propiedad no tiene anticipos disponibles.',
      );
    }
    const open = await this.openReceipts(db, input.propertyId);
    const pending = open.reduce((s, r) => s + r.outstanding, 0);
    if (pending === 0) {
      throw new ConflictException(
        'Esta propiedad no tiene recibos pendientes a los que aplicar el anticipo.',
      );
    }
    const amount = Math.min(available, pending);
    const { allocations } = this.allocate(amount, open, input.receiptIds);
    const applied = allocations.reduce((s, a) => s + a.amount, 0);

    await this.journal.post(db, {
      estateId: input.estateId,
      date: accountingDay(input.date),
      sourceType: 'advance_application',
      sourceId: input.propertyId,
      concept: `Aplicación de anticipo a ${this.receiptNumbers(open, allocations)}`,
      createdByUserId: input.userId,
      lines: [
        {
          account: { role: 'owners_receivable' },
          debit: applied,
          propertyId: input.propertyId,
        },
        ...this.receivableCredits(input.propertyId, allocations, 0),
      ],
    });
    await this.applyToReceipts(db, open, allocations);
    return { applied, allocations };
  }

  // ── Ingresos sin identificar (555) ──────────────────────────────────────

  async registerSuspense(
    db: Db,
    input: {
      estateId: string;
      date: Date;
      amount: Cents;
      concept: string;
      bankAccountId?: string | null;
      userId?: string;
    },
  ) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new UnprocessableEntityException(
        'El importe debe ser mayor que cero.',
      );
    }
    const bankAccountId =
      input.bankAccountId ??
      (await ensureDefaultBankAccount(db, input.estateId));
    const id = randomUUID();
    const date = accountingDay(input.date);
    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date,
      sourceType: 'treasury',
      sourceId: id,
      concept: `Ingreso sin identificar: ${input.concept}`.slice(0, 255),
      createdByUserId: input.userId,
      lines: [
        { account: { bankAccountId }, debit: input.amount },
        { account: { role: 'suspense' }, credit: input.amount },
      ],
    });
    return db.suspenseItem.create({
      data: {
        id,
        estateId: input.estateId,
        date,
        amount: fromCents(input.amount),
        concept: input.concept.slice(0, 255),
        bankAccountId,
        entryId: entry.id,
        createdByUserId: input.userId ?? null,
      },
    });
  }

  /** Lo que queda sin aplicar de un ingreso sin identificar (céntimos). */
  async suspenseRemaining(db: Db, suspenseItemId: string): Promise<Cents> {
    const item = await db.suspenseItem.findUniqueOrThrow({
      where: { id: suspenseItemId },
      select: { amount: true },
    });
    const applied = await db.collection.aggregate({
      where: { suspenseItemId, undoneAt: null },
      _sum: { amount: true },
    });
    return (
      toCents(item.amount) -
      (applied._sum.amount ? toCents(applied._sum.amount) : 0)
    );
  }

  /**
   * Aplica (todo o parte de) un ingreso sin identificar a una propiedad:
   * Debe 555 / Haber 430. Es un cobro más (con su historial, deshacer y
   * devolución), con el dinero ya en el banco desde que llegó.
   */
  async applySuspense(
    db: Db,
    input: {
      suspenseItemId: string;
      propertyId: string;
      amount: Cents;
      date: Date;
      receiptIds?: string[];
      userId?: string;
    },
  ): Promise<Collection> {
    await db.$queryRaw`SELECT 1 FROM "suspense_items" WHERE "id" = ${input.suspenseItemId}::uuid FOR UPDATE`;
    const item = await db.suspenseItem.findUnique({
      where: { id: input.suspenseItemId },
    });
    if (!item)
      throw new NotFoundException('El ingreso sin identificar no existe.');
    const remaining = await this.suspenseRemaining(db, item.id);
    if (input.amount <= 0 || input.amount > remaining) {
      throw new UnprocessableEntityException(
        `Solo quedan ${(remaining / 100).toFixed(2)} € sin aplicar de este ingreso.`,
      );
    }
    await this.lockProperty(db, item.estateId, input.propertyId);
    const open = await this.openReceipts(db, input.propertyId);
    const { allocations, advance } = this.allocate(
      input.amount,
      open,
      input.receiptIds,
    );
    const collectionId = randomUUID();
    const date = accountingDay(input.date);

    const entry = await this.journal.post(db, {
      estateId: item.estateId,
      date,
      sourceType: 'suspense_application',
      sourceId: collectionId,
      concept: `Aplicación del ingreso sin identificar del ${item.date.toISOString().slice(0, 10)}`,
      createdByUserId: input.userId,
      lines: [
        { account: { role: 'suspense' }, debit: input.amount },
        ...this.receivableCredits(input.propertyId, allocations, advance),
      ],
    });
    await this.applyToReceipts(db, open, allocations);
    return db.collection.create({
      data: {
        id: collectionId,
        estateId: item.estateId,
        propertyId: input.propertyId,
        date,
        amount: fromCents(input.amount),
        method: 'Transferencia',
        bankAccountId: item.bankAccountId,
        entryId: entry.id,
        suspenseItemId: item.id,
        notes: `Ingreso sin identificar: ${item.concept}`.slice(0, 255),
        createdByUserId: input.userId ?? null,
      },
    });
  }

  // ── Remesas ──────────────────────────────────────────────────────────────

  /**
   * El banco abona la remesa: un único asiento (Debe banco por el total /
   * Haber 430 de cada recibo) y un cobro por línea. Cada recibo debe seguir
   * debiendo al menos el importe de su línea.
   */
  async collectRemesa(
    db: Db,
    remesaId: string,
    opts: { date: Date; userId?: string },
  ) {
    const remesa = await db.remesaHistoryItem.findUnique({
      where: { id: remesaId },
      include: {
        lines: { where: { status: 'Pendiente' }, orderBy: { id: 'asc' } },
      },
    });
    if (!remesa) throw new NotFoundException('La remesa no existe.');
    if (remesa.status !== 'Presentada') {
      throw new ConflictException(
        `La remesa está ${remesa.status.toLowerCase()}: solo se cobra una remesa presentada.`,
      );
    }
    if (remesa.lines.length === 0) {
      throw new ConflictException(
        'La remesa no tiene líneas pendientes de cobro.',
      );
    }
    const receiptIds = remesa.lines.map((l) => l.receiptId);
    await db.$queryRaw`SELECT 1 FROM "receipts" WHERE "id" = ANY(${receiptIds}::uuid[]) FOR UPDATE`;
    const receipts = await db.accountingReceipt.findMany({
      where: { id: { in: receiptIds } },
    });
    const byId = new Map(receipts.map((r) => [r.id, r]));
    const conflicts = remesa.lines.filter((l) => {
      const r = byId.get(l.receiptId);
      return !r || r.status === 'Anulado' || r.outstanding.lessThan(l.amount);
    });
    if (conflicts.length > 0) {
      const nos = conflicts
        .map((l) => byId.get(l.receiptId)?.no ?? l.receiptId)
        .join(', ');
      throw new ConflictException(
        `Estos recibos ya no deben el importe de la remesa (cobrados o anulados después): ${nos}. Márcalos como rechazados antes de cobrar la remesa.`,
      );
    }

    const bankAccountId =
      remesa.bankAccountId ??
      (await ensureDefaultBankAccount(db, remesa.estateId));
    const date = accountingDay(opts.date);
    const total = remesa.lines.reduce((s, l) => s + toCents(l.amount), 0);
    const entry = await this.journal.post(db, {
      estateId: remesa.estateId,
      date,
      sourceType: 'remesa_collection',
      sourceId: remesa.id,
      concept:
        `Cobro de la remesa ${remesa.messageId ?? remesa.id.slice(0, 8)} · ${remesa.concept}`.slice(
          0,
          255,
        ),
      createdByUserId: opts.userId,
      lines: [
        { account: { bankAccountId }, debit: total },
        ...remesa.lines.map((l) => ({
          account: { role: 'owners_receivable' as const },
          credit: toCents(l.amount),
          propertyId: l.propertyId,
          receiptId: l.receiptId,
        })),
      ],
    });

    for (const line of remesa.lines) {
      const r = byId.get(line.receiptId)!;
      const outstanding = toCents(r.outstanding) - toCents(line.amount);
      await db.accountingReceipt.update({
        where: { id: r.id },
        data: {
          outstanding: fromCents(outstanding),
          status: receiptStatusFor(toCents(r.amount), outstanding, {
            previous: r.status,
          }),
          method: 'Domiciliacion',
          date: new Date(),
        },
      });
      await db.collection.create({
        data: {
          estateId: remesa.estateId,
          propertyId: line.propertyId,
          date,
          amount: line.amount,
          method: 'Domiciliacion',
          bankAccountId,
          entryId: entry.id,
          remesaLineId: line.id,
          createdByUserId: opts.userId ?? null,
        },
      });
      await db.remesaLine.update({
        where: { id: line.id },
        data: { status: 'Cobrado' },
      });
    }
    return db.remesaHistoryItem.update({
      where: { id: remesa.id },
      data: {
        status: 'Cobrada',
        bankAccountId,
        collectedAt: date,
        collectedByUserId: opts.userId ?? null,
        collectionEntryId: entry.id,
      },
    });
  }

  /**
   * Devolución de una línea de remesa. Si la remesa ya se cobró, es una
   * devolución bancaria (con su asiento). Si todavía no, es un rechazo
   * previo al cargo: no hubo dinero, la línea queda rechazada y el recibo
   * marcado como devuelto para que se vea que el adeudo falló.
   */
  async returnRemesaLine(
    db: Db,
    lineId: string,
    opts: {
      date: Date;
      returnCode?: string | null;
      returnReason?: string | null;
      feeAmount?: Cents;
      rechargeFee?: boolean;
      source?: 'manual' | 'pain002' | 'camt054' | 'n19';
      userId?: string;
    },
  ) {
    const line = await db.remesaLine.findUnique({
      where: { id: lineId },
      include: {
        collection: true,
        remesa: { select: { id: true, status: true } },
      },
    });
    if (!line) throw new NotFoundException('La línea de remesa no existe.');
    if (line.status === 'Devuelto' || line.status === 'Rechazado') {
      throw new ConflictException('Esta línea ya está devuelta.');
    }

    if (line.status === 'Cobrado' && line.collection) {
      await this.returnCollection(db, line.collection.id, opts);
      await db.remesaLine.update({
        where: { id: line.id },
        data: {
          status: 'Devuelto',
          returnCode: opts.returnCode ?? null,
          returnReason: opts.returnReason ?? null,
        },
      });
      await db.remesaHistoryItem.update({
        where: { id: line.remesa.id },
        data: { status: 'ConDevoluciones' },
      });
    } else {
      await db.remesaLine.update({
        where: { id: line.id },
        data: {
          status: 'Rechazado',
          returnCode: opts.returnCode ?? null,
          returnReason: opts.returnReason ?? null,
        },
      });
      await this.receipts.markReturned(db, line.receiptId, {
        returnCode: opts.returnCode,
        returnReason: opts.returnReason,
        createdByUserId: opts.userId,
      });
    }
    return db.remesaLine.findUniqueOrThrow({ where: { id: line.id } });
  }

  // ── Ayudas internas ─────────────────────────────────────────────────────

  /** Bloquea la propiedad (serializa sus operaciones de cobro) y comprueba que es de la finca. */
  private async lockProperty(
    db: Db,
    estateId: string,
    propertyId: string,
  ): Promise<void> {
    const rows = await db.$queryRaw<{ estate_id: string | null }[]>`
      SELECT "estate_id" FROM "properties" WHERE "id" = ${propertyId}::uuid FOR UPDATE
    `;
    if (rows.length === 0 || rows[0].estate_id !== estateId) {
      throw new NotFoundException('La propiedad no existe en esta finca.');
    }
  }

  private async openReceipts(
    db: Db,
    propertyId: string,
  ): Promise<(OpenReceipt & { amount: Cents; status: ReceiptStatus })[]> {
    const rows = await db.accountingReceipt.findMany({
      where: { propertyId, status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        no: true,
        kind: true,
        amount: true,
        outstanding: true,
        status: true,
        originYear: true,
        accrualDate: true,
        dueDate: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      no: r.no,
      kind: r.kind,
      amount: toCents(r.amount),
      outstanding: toCents(r.outstanding),
      status: r.status,
      originYear: r.originYear,
      accrualDate: r.accrualDate,
      dueDate: r.dueDate,
    }));
  }

  private allocate(amount: Cents, open: OpenReceipt[], receiptIds?: string[]) {
    try {
      return allocateCollection(amount, open, receiptIds);
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }
  }

  private receivableCredits(
    propertyId: string,
    allocations: Allocation[],
    advance: Cents,
  ): LineDraft[] {
    return [
      ...allocations.map((a) => ({
        account: { role: 'owners_receivable' as const },
        credit: a.amount,
        propertyId,
        receiptId: a.receiptId,
      })),
      ...(advance > 0
        ? [
            {
              account: { role: 'owners_receivable' as const },
              credit: advance,
              propertyId,
              concept: 'Anticipo del propietario',
            },
          ]
        : []),
    ];
  }

  private async applyToReceipts(
    db: Db,
    open: (OpenReceipt & { amount: Cents; status: ReceiptStatus })[],
    allocations: Allocation[],
  ): Promise<void> {
    const byId = new Map(open.map((r) => [r.id, r]));
    for (const a of allocations) {
      const r = byId.get(a.receiptId)!;
      const outstanding = r.outstanding - a.amount;
      await db.accountingReceipt.update({
        where: { id: r.id },
        data: {
          outstanding: fromCents(outstanding),
          status: receiptStatusFor(r.amount, outstanding, {
            previous: r.status,
          }),
          date: new Date(),
        },
      });
    }
  }

  /** Los recibos vuelven a deber lo que el cobro les imputó (deshacer o devolución). */
  private async reopenReceipts(
    db: Db,
    allocations: Allocation[],
    opts: {
      returned: boolean;
      returnCode?: string | null;
      returnReason?: string | null;
    },
  ): Promise<void> {
    for (const a of allocations) {
      const r = await db.accountingReceipt.findUniqueOrThrow({
        where: { id: a.receiptId },
      });
      const outstanding = toCents(r.outstanding) + a.amount;
      await db.accountingReceipt.update({
        where: { id: r.id },
        data: {
          outstanding: fromCents(outstanding),
          status: receiptStatusFor(toCents(r.amount), outstanding, {
            returned: opts.returned,
          }),
          ...(opts.returned
            ? {
                method: 'Devolucion',
                returnCode: opts.returnCode ?? null,
                returnReason: opts.returnReason ?? null,
              }
            : {}),
          date: new Date(),
        },
      });
    }
  }

  private async loadActiveCollection(db: Db, collectionId: string) {
    await db.$queryRaw`SELECT 1 FROM "collections" WHERE "id" = ${collectionId}::uuid FOR UPDATE`;
    const collection = await db.collection.findUnique({
      where: { id: collectionId },
      include: { returnRecord: { select: { id: true } } },
    });
    if (!collection) throw new NotFoundException('El cobro no existe.');
    if (collection.undoneAt)
      throw new ConflictException('Este cobro ya está deshecho.');
    if (collection.returnRecord)
      throw new ConflictException('Este cobro ya está devuelto.');
    return collection;
  }

  /** Imputaciones y anticipo del cobro, leídos de su asiento. */
  private async creditsOf(
    db: Db,
    collection: {
      entryId: string;
      propertyId: string;
      remesaLineId: string | null;
    },
  ): Promise<{ allocations: Allocation[]; advance: Cents }> {
    let receiptFilter: string | undefined;
    if (collection.remesaLineId) {
      const line = await db.remesaLine.findUniqueOrThrow({
        where: { id: collection.remesaLineId },
        select: { receiptId: true },
      });
      receiptFilter = line.receiptId;
    }
    const lines = await db.journalLine.findMany({
      where: {
        entryId: collection.entryId,
        propertyId: collection.propertyId,
        credit: { gt: 0 },
        account: { systemRole: 'owners_receivable' },
        ...(receiptFilter ? { receiptId: receiptFilter } : {}),
      },
      select: { receiptId: true, credit: true },
    });
    const allocations = lines
      .filter((l) => l.receiptId)
      .map((l) => ({ receiptId: l.receiptId!, amount: toCents(l.credit) }));
    const advance = lines
      .filter((l) => !l.receiptId)
      .reduce((s, l) => s + toCents(l.credit), 0);
    return { allocations, advance };
  }

  private async assertAdvanceAvailable(
    db: Db,
    propertyId: string,
    advance: Cents,
  ): Promise<void> {
    if (advance === 0) return;
    const available = await this.availableAdvance(db, propertyId);
    if (available < advance) {
      throw new ConflictException(
        'El anticipo que generó este cobro ya se aplicó a otros recibos: deshaz antes esa aplicación.',
      );
    }
  }

  private async rechargeReturnFee(
    db: Db,
    collection: Collection,
    fee: Cents,
    date: Date,
    userId?: string,
  ): Promise<string> {
    const periodKey = date.toISOString().slice(0, 7);
    const period = await db.accountingPeriod.upsert({
      where: {
        estateId_periodKey: { estateId: collection.estateId, periodKey },
      },
      update: {},
      create: {
        estateId: collection.estateId,
        periodKey,
        label: periodKey,
        monthAbbrev: periodKey.slice(5),
      },
    });
    const seq = await this.receipts.nextNumber(
      db,
      collection.estateId,
      period.id,
      `${periodKey}M`,
    );
    const property = await db.property.findUniqueOrThrow({
      where: { id: collection.propertyId },
      select: { ref: true, staircase: true, floor: true, door: true },
    });
    const receipt = await this.receipts.issue(db, {
      estateId: collection.estateId,
      periodId: period.id,
      periodKey,
      propertyId: collection.propertyId,
      no: `${periodKey.replace('-', '/')}-M${String(seq).padStart(3, '0')}`,
      concept: 'Gastos de devolución bancaria',
      kind: 'gastos_devolucion',
      amount: fee,
      dueDate: date,
      method: 'Transferencia',
      manual: true,
      includeInRemesa: false,
      ownerNameSnapshot:
        property.ref ??
        [property.staircase, property.floor, property.door]
          .filter(Boolean)
          .join('-'),
      createdByUserId: userId,
    });
    return receipt.id;
  }

  private collectionConcept(
    open: OpenReceipt[],
    allocations: Allocation[],
    advance: Cents,
  ): string {
    const nos = this.receiptNumbers(open, allocations);
    if (allocations.length === 0) return 'Anticipo del propietario';
    return `Cobro de ${nos}${advance > 0 ? ' y anticipo' : ''}`.slice(0, 255);
  }

  private receiptNumbers(
    open: OpenReceipt[],
    allocations: Allocation[],
  ): string {
    const byId = new Map(open.map((r) => [r.id, r.no]));
    const nos = allocations.map((a) => byId.get(a.receiptId) ?? '');
    return nos.length === 1
      ? `el recibo ${nos[0]}`
      : `los recibos ${nos.join(', ')}`;
  }
}
