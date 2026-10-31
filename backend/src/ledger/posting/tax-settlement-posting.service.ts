import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  Prisma,
  TaxSettlement,
  TaxSettlementKind,
} from '../../prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalService } from '../journal/journal.service';
import { ensureDefaultBankAccount } from '../chart/ledger-bootstrap';
import { fromCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';

type Db = Prisma.TransactionClient;

const PERIOD: Record<TaxSettlementKind, RegExp> = {
  modelo111: /^\d{4}-T[1-4]$/,
  seguridad_social: /^\d{4}-(0[1-9]|1[0-2])$/,
};

/**
 * Pagos a Hacienda y a la Seguridad Social (fase 7b): el ingreso del 111
 * salda la 4751 y el de las cuotas salda la 476, contra el banco.
 */
@Injectable()
export class TaxSettlementPostingService {
  constructor(private readonly journal: JournalService) {}

  async settle(
    db: Db,
    input: {
      estateId: string;
      kind: TaxSettlementKind;
      period: string;
      date: Date;
      amount: Cents;
      bankAccountId?: string | null;
      reference?: string | null;
      userId?: string;
    },
  ): Promise<TaxSettlement> {
    if (!PERIOD[input.kind].test(input.period)) {
      throw new UnprocessableEntityException(
        input.kind === 'modelo111'
          ? 'El periodo del 111 es el trimestre: AAAA-T1 a AAAA-T4.'
          : 'El periodo de la Seguridad Social es el mes: AAAA-MM.',
      );
    }
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
    const role =
      input.kind === 'modelo111'
        ? 'withholding_payable'
        : 'social_security_payable';
    const label =
      input.kind === 'modelo111'
        ? `Ingreso del modelo 111 · ${input.period}`
        : `Seguridad Social · ${input.period}`;
    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date,
      sourceType: 'tax_settlement',
      sourceId: id,
      concept:
        `${label}${input.reference ? ` · ${input.reference}` : ''}`.slice(
          0,
          255,
        ),
      reference: input.reference?.slice(0, 100) ?? undefined,
      createdByUserId: input.userId,
      lines: [
        { account: { role }, debit: input.amount },
        { account: { bankAccountId }, credit: input.amount },
      ],
    });
    return db.taxSettlement.create({
      data: {
        id,
        estateId: input.estateId,
        kind: input.kind,
        period: input.period,
        date,
        amount: fromCents(input.amount),
        bankAccountId,
        reference: input.reference?.slice(0, 40) ?? null,
        entryId: entry.id,
        createdByUserId: input.userId ?? null,
      },
    });
  }

  async undo(
    db: Db,
    id: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<TaxSettlement> {
    await db.$queryRaw`SELECT 1 FROM "tax_settlements" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const settlement = await db.taxSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('El ingreso no existe.');
    if (settlement.undoneAt)
      throw new ConflictException('Este ingreso ya está deshecho.');
    const reversal = await this.journal.reverse(db, settlement.entryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept: `Ingreso deshecho: ${opts.reason}`.slice(0, 255),
      createdByUserId: opts.userId,
    });
    return db.taxSettlement.update({
      where: { id },
      data: {
        undoneAt: new Date(),
        undoReason: opts.reason.slice(0, 255),
        undoEntryId: reversal.id,
      },
    });
  }
}
