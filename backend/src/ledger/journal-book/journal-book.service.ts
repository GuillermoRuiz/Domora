import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccountRole, JournalSource, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { StorageService } from '../../files/storage.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { JournalService } from '../journal/journal.service';
import { runPosting } from '../journal/journal-db-errors';
import {
  TreasuryPostingService,
  type MoneyPlace,
} from '../posting/treasury-posting.service';
import { accountingDay } from '../posting/draft-validation';
import { toCents } from '../money';
import type {
  CreateManualEntryDto,
  ListJournalQuery,
  QuickEntryDto,
  ReverseEntryDto,
  TransferDto,
} from './journal-book.dto';

export interface UploadedEntryFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Asientos que se anulan desde el diario; los demás, desde su documento. */
const REVERSIBLE_HERE: JournalSource[] = ['manual', 'treasury'];

/** Cuentas que solo se mueven con sus documentos, para que cuadren con ellos. */
const DOCUMENT_ROLES: AccountRole[] = [
  'owners_receivable',
  'suppliers_payable',
  'creditors_payable',
  'suspense',
];

const SOURCE_LABELS: Record<JournalSource, string> = {
  manual: 'Asiento manual',
  treasury: 'Tesorería',
  receipt_issue: 'Emisión de recibo',
  receipt_cancel: 'Anulación de recibo',
  collection: 'Cobro',
  collection_undo: 'Cobro deshecho',
  remesa_collection: 'Cobro de remesa',
  receipt_return: 'Devolución',
  advance_application: 'Aplicación de anticipo',
  suspense_application: 'Ingreso identificado',
  interest_accrual: 'Intereses de demora',
  supplier_invoice: 'Factura de proveedor',
  supplier_invoice_cancel: 'Anulación de factura',
  supplier_payment: 'Pago a proveedor',
  supplier_payment_undo: 'Pago deshecho',
  tax_settlement: 'Impuestos y Seguridad Social',
  payroll: 'Nómina',
  reserve_use: 'Uso del fondo de reserva',
  opening_balance: 'Apertura',
  year_close: 'Cierre del ejercicio',
  year_reopen: 'Reapertura',
  import: 'Importación',
};

const ENTRY_INCLUDE = {
  lines: {
    orderBy: { lineNo: 'asc' },
    select: {
      id: true,
      lineNo: true,
      debit: true,
      credit: true,
      concept: true,
      account: { select: { id: true, code: true, name: true } },
      property: {
        select: {
          id: true,
          ref: true,
          staircase: true,
          floor: true,
          door: true,
        },
      },
      supplier: { select: { id: true, name: true } },
      costCentre: { select: { id: true, name: true } },
      receipt: { select: { id: true, no: true } },
      supplierInvoice: { select: { id: true, number: true } },
    },
  },
  reverses: { select: { id: true, number: true, fiscalYear: true } },
  reversedBy: { select: { id: true, number: true, fiscalYear: true } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, createdAt: true },
  },
} satisfies Prisma.JournalEntryInclude;

type EntryRow = Prisma.JournalEntryGetPayload<{
  include: typeof ENTRY_INCLUDE;
}>;

function propertyLabel(p: {
  ref: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
}): string {
  return p.ref ?? [p.staircase, p.floor, p.door].filter(Boolean).join('-');
}

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * El libro diario visto por la gestora (fase 8): consultarlo, registrar
 * asientos manuales y movimientos de tesorería, anular lo que se registró a
 * mano y adjuntar justificantes.
 */
@Injectable()
export class JournalBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
    private readonly journal: JournalService,
    private readonly treasury: TreasuryPostingService,
  ) {}

  async list(
    estateId: string,
    query: ListJournalQuery,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.JournalEntryWhereInput = {
      estateId,
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: day(query.from) } : {}),
              ...(query.to ? { lte: day(query.to) } : {}),
            },
          }
        : {}),
      ...(query.sourceType
        ? { sourceType: query.sourceType as JournalSource }
        : {}),
      ...(query.accountId
        ? { lines: { some: { accountId: query.accountId } } }
        : {}),
      ...(query.q
        ? { concept: { contains: query.q, mode: 'insensitive' } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { fiscalYear: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ENTRY_INCLUDE,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((e) => this.view(e)) };
  }

  async detail(entryId: string, user: AuthenticatedUser) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('El asiento no existe.');
    this.estateAccess.assertAccess(entry.estateId, user);
    return this.view(entry);
  }

  async createManual(
    estateId: string,
    dto: CreateManualEntryDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const lines = dto.lines.map((l) => ({
      ...l,
      debitC: toCents(l.debit),
      creditC: toCents(l.credit),
    }));
    for (const [i, l] of lines.entries()) {
      if (l.debitC > 0 === l.creditC > 0) {
        throw new UnprocessableEntityException(
          `La línea ${i + 1} debe llevar importe en el debe o en el haber, no en los dos.`,
        );
      }
    }
    const debit = lines.reduce((s, l) => s + l.debitC, 0);
    const credit = lines.reduce((s, l) => s + l.creditC, 0);
    if (debit !== credit) {
      throw new UnprocessableEntityException(
        `El asiento no cuadra: debe ${(debit / 100).toFixed(2)} €, haber ${(credit / 100).toFixed(2)} €.`,
      );
    }
    const accounts = await this.prisma.chartAccount.findMany({
      where: {
        id: { in: [...new Set(lines.map((l) => l.accountId))] },
        estateId,
      },
      select: {
        id: true,
        code: true,
        systemRole: true,
        requiresProperty: true,
        requiresSupplier: true,
      },
    });
    for (const l of lines) {
      const a = accounts.find((x) => x.id === l.accountId);
      if (!a)
        throw new NotFoundException(
          'Una línea usa una cuenta que no es de esta finca.',
        );
      if (
        a.requiresProperty ||
        a.requiresSupplier ||
        (a.systemRole && DOCUMENT_ROLES.includes(a.systemRole))
      ) {
        throw new UnprocessableEntityException(
          `La cuenta ${a.code} solo se mueve con sus documentos (recibos, cobros, facturas o pagos) para que cuadren con ellos.`,
        );
      }
    }
    const entry = await runPosting(this.prisma, (tx) =>
      this.journal.post(tx, {
        estateId,
        date: day(dto.date),
        sourceType: 'manual',
        concept: dto.concept,
        reference: dto.reference?.trim() || undefined,
        createdByUserId: user.id,
        lines: lines.map((l) => ({
          account: { accountId: l.accountId },
          ...(l.debitC > 0 ? { debit: l.debitC } : { credit: l.creditC }),
          costCentreId: l.costCentreId ?? undefined,
          concept: l.concept?.trim() || undefined,
        })),
      }),
    );
    return this.detail(entry.id, user);
  }

  async quickEntry(
    estateId: string,
    dto: QuickEntryDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const entry = await runPosting(this.prisma, (tx) =>
      this.treasury.quickEntry(tx, {
        estateId,
        date: day(dto.date),
        direction: dto.direction,
        amount: toCents(dto.amount),
        place: this.place(dto.bankAccountId),
        counterpartAccountId: dto.counterpartAccountId,
        costCentreId: dto.costCentreId ?? null,
        concept: dto.concept,
        reference: dto.reference ?? null,
        userId: user.id,
      }),
    );
    return this.detail(entry.id, user);
  }

  async transfer(estateId: string, dto: TransferDto, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const entry = await runPosting(this.prisma, (tx) =>
      this.treasury.transfer(tx, {
        estateId,
        date: day(dto.date),
        amount: toCents(dto.amount),
        from: this.place(dto.fromBankAccountId),
        to: this.place(dto.toBankAccountId),
        concept: dto.concept,
        userId: user.id,
      }),
    );
    return this.detail(entry.id, user);
  }

  /** Anula un asiento manual o de tesorería con un contraasiento. */
  async reverse(
    entryId: string,
    dto: ReverseEntryDto,
    user: AuthenticatedUser,
  ) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: {
        estateId: true,
        sourceType: true,
        reversesEntryId: true,
        number: true,
        fiscalYear: true,
      },
    });
    if (!entry) throw new NotFoundException('El asiento no existe.');
    this.estateAccess.assertAccess(entry.estateId, user);
    if (!REVERSIBLE_HERE.includes(entry.sourceType)) {
      throw new ConflictException(
        `Este asiento es de "${SOURCE_LABELS[entry.sourceType]}": se anula desde su documento, no desde el diario.`,
      );
    }
    if (entry.reversesEntryId) {
      throw new ConflictException(
        'Este asiento ya es una anulación: registra otro si hace falta.',
      );
    }
    const reversal = await runPosting(this.prisma, (tx) =>
      this.journal.reverse(tx, entryId, {
        date: accountingDay(dto.date ? day(dto.date) : new Date()),
        concept:
          `Anulación del asiento ${entry.fiscalYear}/${entry.number}: ${dto.reason}`.slice(
            0,
            255,
          ),
        createdByUserId: user.id,
      }),
    );
    return this.detail(reversal.id, user);
  }

  async attach(
    entryId: string,
    file: UploadedEntryFile | undefined,
    user: AuthenticatedUser,
  ) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: { estateId: true },
    });
    if (!entry) throw new NotFoundException('El asiento no existe.');
    this.estateAccess.assertAccess(entry.estateId, user);
    if (!file)
      throw new NotFoundException(
        'No se recibió ningún fichero (campo "file").',
      );
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `journal-entries/${entryId}`,
      file.originalname,
      file.buffer,
    );
    await this.prisma.journalEntryAttachment.create({
      data: {
        entryId,
        fileName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        s3Key,
        createdByUserId: user.id,
      },
    });
    return this.detail(entryId, user);
  }

  async attachmentContent(
    entryId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ) {
    const att = await this.prisma.journalEntryAttachment.findFirst({
      where: { id: attachmentId, entryId },
      include: { entry: { select: { estateId: true } } },
    });
    if (!att) throw new NotFoundException('El adjunto no existe.');
    this.estateAccess.assertAccess(att.entry.estateId, user);
    return {
      content: await this.storage.get(att.s3Key),
      fileName: att.fileName,
      mimeType: att.mimeType,
    };
  }

  // ── Ayudas ──────────────────────────────────────────────────────────────

  private place(bankAccountId: string | undefined): MoneyPlace {
    return bankAccountId ? { bankAccountId } : { cash: true };
  }

  private view(e: EntryRow) {
    return {
      id: e.id,
      fiscalYear: e.fiscalYear,
      number: e.number,
      date: e.date,
      entryType: e.entryType,
      sourceType: e.sourceType,
      sourceLabel: SOURCE_LABELS[e.sourceType],
      concept: e.concept,
      reference: e.reference,
      reverses: e.reverses,
      reversedBy: e.reversedBy,
      canReverse:
        REVERSIBLE_HERE.includes(e.sourceType) &&
        !e.reversesEntryId &&
        !e.reversedBy,
      attachments: e.attachments,
      total: e.lines.reduce((s, l) => s + Number(l.debit), 0),
      lines: e.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.account.id,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
        concept: l.concept,
        property: l.property ? propertyLabel(l.property) : null,
        supplier: l.supplier?.name ?? null,
        costCentre: l.costCentre?.name ?? null,
        receiptNo: l.receipt?.no ?? null,
        invoiceNumber: l.supplierInvoice?.number ?? null,
      })),
    };
  }
}
