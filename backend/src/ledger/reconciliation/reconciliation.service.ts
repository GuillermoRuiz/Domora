import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { runPosting } from '../journal/journal-db-errors';
import { fromCents, toCents } from '../money';
import { parseNorma43 } from './parsers/norma43-parser.util';
import { parseCsvBankExtract } from './parsers/csv-bank-parser.util';
import { autoMatch } from './reconciliation.rules';

export interface UploadedStatementFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Conciliación bancaria sobre el diario (fase 8b): el extracto del banco
 * contra las líneas del diario de esa cuenta (572xxxx). Lo que el banco ha
 * apuntado y la contabilidad no, o al revés, queda a la vista.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async importStatement(
    estateId: string,
    bankAccountId: string,
    file: UploadedStatementFile | undefined,
    user: AuthenticatedUser,
  ) {
    const bank = await this.bank(estateId, bankAccountId, user);
    if (!file?.buffer?.length)
      throw new BadRequestException(
        'No se recibió ningún fichero (campo "file").',
      );
    if (file.size > MAX_STATEMENT_BYTES)
      throw new BadRequestException('El fichero supera los 5 MB.');

    const lower = file.originalname.toLowerCase();
    let parsed: {
      entries: {
        date: string;
        concept: string;
        amount: number;
        bankRef?: string;
      }[];
      warnings: string[];
      openingBalance: number | null;
      closingBalance: number | null;
      periodFrom: string | null;
      periodTo: string | null;
      format: string;
    };
    if (
      lower.endsWith('.n43') ||
      lower.endsWith('.943') ||
      lower.endsWith('.c43') ||
      lower.endsWith('.aeb') ||
      lower.endsWith('.txt')
    ) {
      const r = parseNorma43(file.buffer);
      parsed = { ...r, entries: r.movements, format: 'n43' };
    } else if (lower.endsWith('.csv')) {
      const entries = await parseCsvBankExtract(file.buffer, file.originalname);
      parsed = {
        entries,
        warnings: [],
        openingBalance: null,
        closingBalance: null,
        periodFrom: null,
        periodTo: null,
        format: 'csv',
      };
    } else {
      throw new BadRequestException(
        'Formato no admitido: Norma 43 (.n43, .943, .c43, .aeb, .txt) o CSV.',
      );
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const already = await this.prisma.bankStatement.findUnique({
      where: { bankAccountId_fileHash: { bankAccountId: bank.id, fileHash } },
      select: { importedAt: true },
    });
    if (already) {
      throw new ConflictException(
        `Este extracto ya se importó el ${already.importedAt.toLocaleDateString('es-ES')}.`,
      );
    }

    // Una partida ya importada (por otro fichero que se solapa) no se repite.
    const dates = parsed.entries.map((e) => day(e.date));
    const existing = dates.length
      ? await this.prisma.bankExtractEntry.findMany({
          where: {
            bankAccountId: bank.id,
            date: {
              gte: new Date(Math.min(...dates.map((d) => d.getTime()))),
              lte: new Date(Math.max(...dates.map((d) => d.getTime()))),
            },
          },
          select: { date: true, amount: true, concept: true, bankRef: true },
        })
      : [];
    const keyOf = (
      date: string,
      cents: number,
      concept: string,
      ref: string | null | undefined,
    ) => `${date}|${cents}|${concept.trim()}|${ref ?? ''}`;
    const seen = new Map<string, number>();
    for (const e of existing) {
      const k = keyOf(iso(e.date), toCents(e.amount), e.concept, e.bankRef);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const toInsert = parsed.entries.filter((e) => {
      const k = keyOf(
        e.date.slice(0, 10),
        Math.round(e.amount * 100),
        e.concept,
        e.bankRef,
      );
      const count = seen.get(k) ?? 0;
      if (count > 0) {
        seen.set(k, count - 1);
        return false;
      }
      return true;
    });

    const statementId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatement.create({
        data: {
          id: statementId,
          estateId,
          bankAccountId: bank.id,
          fileName: file.originalname.slice(0, 255),
          fileHash,
          format: parsed.format,
          periodFrom: parsed.periodFrom ? day(parsed.periodFrom) : null,
          periodTo: parsed.periodTo ? day(parsed.periodTo) : null,
          openingBalance:
            parsed.openingBalance !== null
              ? new Prisma.Decimal(parsed.openingBalance.toFixed(2))
              : null,
          closingBalance:
            parsed.closingBalance !== null
              ? new Prisma.Decimal(parsed.closingBalance.toFixed(2))
              : null,
          entriesCount: toInsert.length,
          importedByUserId: user.id,
        },
      });
      if (toInsert.length > 0) {
        await tx.bankExtractEntry.createMany({
          data: toInsert.map((e) => ({
            estateId,
            bankAccountId: bank.id,
            statementId,
            date: day(e.date),
            concept: e.concept.slice(0, 500),
            amount: new Prisma.Decimal(e.amount.toFixed(2)),
            bankRef: e.bankRef ?? null,
            importBatchId: statementId,
          })),
        });
      }
    });
    return {
      statementId,
      imported: toInsert.length,
      skippedDuplicates: parsed.entries.length - toInsert.length,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      warnings: parsed.warnings,
    };
  }

  /**
   * Mayor de la cuenta bancaria: sus líneas del diario con el saldo corrido
   * (desde el principio, aunque se pida un rango) y si están conciliadas.
   */
  async ledger(
    estateId: string,
    bankAccountId: string,
    opts: { from?: string; to?: string },
    user: AuthenticatedUser,
  ) {
    const bank = await this.bank(estateId, bankAccountId, user);
    const from = opts.from ? day(opts.from) : undefined;
    const to = opts.to ? day(opts.to) : undefined;
    const before = from
      ? await this.prisma.journalLine.aggregate({
          where: { accountId: bank.chartAccountId, date: { lt: from } },
          _sum: { debit: true, credit: true },
        })
      : null;
    let balance = before
      ? toCents(before._sum.debit ?? 0) - toCents(before._sum.credit ?? 0)
      : 0;
    const openingBalance = balance;
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: bank.chartAccountId,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [
        { date: 'asc' },
        { entry: { number: 'asc' } },
        { lineNo: 'asc' },
      ],
      take: 5000,
      select: {
        id: true,
        date: true,
        debit: true,
        credit: true,
        concept: true,
        reconciliation: { select: { groupId: true } },
        entry: {
          select: {
            id: true,
            number: true,
            fiscalYear: true,
            sourceType: true,
            concept: true,
            lines: {
              select: {
                accountId: true,
                account: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });
    const rows = lines.map((l) => {
      const amount = toCents(l.debit) - toCents(l.credit);
      balance += amount;
      const counterparts = [
        ...new Set(
          l.entry.lines
            .filter((x) => x.accountId !== bank.chartAccountId)
            .map((x) => `${x.account.code} ${x.account.name}`),
        ),
      ];
      return {
        id: l.id,
        date: iso(l.date),
        entryId: l.entry.id,
        entryNumber: l.entry.number,
        fiscalYear: l.entry.fiscalYear,
        sourceType: l.entry.sourceType,
        concept: l.concept ?? l.entry.concept,
        counterparts,
        amount: amount / 100,
        balance: balance / 100,
        reconciliationGroupId: l.reconciliation?.groupId ?? null,
      };
    });
    return {
      bankAccountId: bank.id,
      alias: bank.alias,
      openingBalance: openingBalance / 100,
      closingBalance: balance / 100,
      lines: rows,
    };
  }

  /** Partidas del extracto de la cuenta, con su estado de conciliación. */
  async statement(
    estateId: string,
    bankAccountId: string,
    opts: { pending?: boolean },
    user: AuthenticatedUser,
  ) {
    const bank = await this.bank(estateId, bankAccountId, user);
    const [entries, lastStatement] = await Promise.all([
      this.prisma.bankExtractEntry.findMany({
        where: {
          bankAccountId: bank.id,
          ...(opts.pending ? { reconciliationGroupId: null } : {}),
        },
        orderBy: [{ date: 'desc' }, { importedAt: 'desc' }],
        take: 5000,
        select: {
          id: true,
          date: true,
          concept: true,
          amount: true,
          bankRef: true,
          reconciliationGroupId: true,
          statementId: true,
        },
      }),
      this.prisma.bankStatement.findFirst({
        where: { bankAccountId: bank.id, closingBalance: { not: null } },
        orderBy: [
          { periodTo: { sort: 'desc', nulls: 'last' } },
          { importedAt: 'desc' },
        ],
        select: {
          id: true,
          fileName: true,
          periodFrom: true,
          periodTo: true,
          closingBalance: true,
          importedAt: true,
        },
      }),
    ]);
    return {
      entries: entries.map((e) => ({
        ...e,
        date: iso(e.date),
        amount: Number(e.amount),
      })),
      lastStatement: lastStatement
        ? {
            ...lastStatement,
            periodFrom: lastStatement.periodFrom
              ? iso(lastStatement.periodFrom)
              : null,
            periodTo: lastStatement.periodTo
              ? iso(lastStatement.periodTo)
              : null,
            closingBalance: Number(lastStatement.closingBalance),
          }
        : null,
    };
  }

  /** Concilia a mano: unas partidas del extracto con unas líneas del diario que suman lo mismo. */
  async match(
    estateId: string,
    bankAccountId: string,
    dto: { entryIds: string[]; lineIds: string[] },
    user: AuthenticatedUser,
  ) {
    const bank = await this.bank(estateId, bankAccountId, user);
    if (dto.entryIds.length === 0 || dto.lineIds.length === 0) {
      throw new UnprocessableEntityException(
        'Elige al menos una partida del extracto y una línea de la contabilidad.',
      );
    }
    const [entries, lines] = await Promise.all([
      this.prisma.bankExtractEntry.findMany({
        where: { id: { in: dto.entryIds }, bankAccountId: bank.id },
        select: { id: true, amount: true, reconciliationGroupId: true },
      }),
      this.prisma.journalLine.findMany({
        where: { id: { in: dto.lineIds }, accountId: bank.chartAccountId },
        select: {
          id: true,
          debit: true,
          credit: true,
          reconciliation: { select: { groupId: true } },
        },
      }),
    ]);
    if (
      entries.length !== new Set(dto.entryIds).size ||
      lines.length !== new Set(dto.lineIds).size
    ) {
      throw new NotFoundException(
        'Alguna partida o línea no es de esta cuenta bancaria.',
      );
    }
    if (
      entries.some((e) => e.reconciliationGroupId) ||
      lines.some((l) => l.reconciliation)
    ) {
      throw new ConflictException(
        'Alguna partida o línea ya está conciliada: deshaz antes esa conciliación.',
      );
    }
    const extractTotal = entries.reduce((s, e) => s + toCents(e.amount), 0);
    const ledgerTotal = lines.reduce(
      (s, l) => s + toCents(l.debit) - toCents(l.credit),
      0,
    );
    if (extractTotal !== ledgerTotal) {
      throw new UnprocessableEntityException(
        `No suman lo mismo: extracto ${Number(fromCents(extractTotal)).toFixed(2)} €, contabilidad ${Number(fromCents(ledgerTotal)).toFixed(2)} €.`,
      );
    }
    const groupId = await runPosting(this.prisma, (tx) =>
      this.createGroup(
        tx,
        estateId,
        bank.id,
        entries.map((e) => e.id),
        lines.map((l) => l.id),
        'manual',
        user.id,
      ),
    );
    return { groupId };
  }

  /** Empareja solo lo evidente: mismo importe y fechas cercanas, 1:1. */
  async autoMatch(
    estateId: string,
    bankAccountId: string,
    user: AuthenticatedUser,
  ) {
    const bank = await this.bank(estateId, bankAccountId, user);
    const [entries, lines] = await Promise.all([
      this.prisma.bankExtractEntry.findMany({
        where: { bankAccountId: bank.id, reconciliationGroupId: null },
        select: { id: true, date: true, amount: true },
      }),
      this.prisma.journalLine.findMany({
        where: { accountId: bank.chartAccountId, reconciliation: null },
        select: { id: true, date: true, debit: true, credit: true },
      }),
    ]);
    const pairs = autoMatch(
      entries.map((e) => ({
        id: e.id,
        date: e.date,
        amount: toCents(e.amount),
      })),
      lines.map((l) => ({
        id: l.id,
        date: l.date,
        amount: toCents(l.debit) - toCents(l.credit),
      })),
    );
    if (pairs.length > 0) {
      await runPosting(
        this.prisma,
        async (tx) => {
          for (const p of pairs) {
            await this.createGroup(
              tx,
              estateId,
              bank.id,
              [p.entryId],
              [p.lineId],
              'auto',
              user.id,
            );
          }
        },
        { timeoutMs: 120_000 },
      );
    }
    return {
      matched: pairs.length,
      pendingEntries: entries.length - pairs.length,
      pendingLines: lines.length - pairs.length,
    };
  }

  async unmatch(groupId: string, user: AuthenticatedUser) {
    const group = await this.prisma.reconciliationGroup.findUnique({
      where: { id: groupId },
      select: { estateId: true },
    });
    if (!group) throw new NotFoundException('La conciliación no existe.');
    this.estateAccess.assertAccess(group.estateId, user);
    await runPosting(this.prisma, async (tx) => {
      await tx.bankExtractEntry.updateMany({
        where: { reconciliationGroupId: groupId },
        data: { reconciliationGroupId: null },
      });
      await tx.reconciliationLine.deleteMany({ where: { groupId } });
      await tx.reconciliationGroup.delete({ where: { id: groupId } });
    });
    return { unmatched: true };
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private async createGroup(
    tx: Prisma.TransactionClient,
    estateId: string,
    bankAccountId: string,
    entryIds: string[],
    lineIds: string[],
    method: 'auto' | 'manual',
    userId: string,
  ): Promise<string> {
    const group = await tx.reconciliationGroup.create({
      data: { estateId, bankAccountId, method, createdByUserId: userId },
      select: { id: true },
    });
    await tx.reconciliationLine.createMany({
      data: lineIds.map((journalLineId) => ({
        groupId: group.id,
        journalLineId,
      })),
    });
    const updated = await tx.bankExtractEntry.updateMany({
      where: { id: { in: entryIds }, reconciliationGroupId: null },
      data: { reconciliationGroupId: group.id },
    });
    if (updated.count !== entryIds.length) {
      throw new ConflictException(
        'Alguna partida del extracto se acaba de conciliar en otra operación.',
      );
    }
    return group.id;
  }

  private async bank(
    estateId: string,
    bankAccountId: string,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, estateId },
      select: { id: true, chartAccountId: true, alias: true },
    });
    if (!bank)
      throw new NotFoundException(
        'La cuenta bancaria no existe en esta finca.',
      );
    return bank;
  }
}
