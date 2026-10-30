import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type ReserveMode } from '../../prisma/client';
import { fromCents, toCents } from '../money';
import { accountingDay, validateDraft } from '../posting/draft-validation';
import type {
  EntryDraft,
  LineDraft,
  PostedEntry,
} from '../posting/posting.types';
import { AccountResolver } from './account-resolver';
import { ensureFiscalYearRow } from './fiscal-year-row';

type Db = Prisma.TransactionClient;

/**
 * Único punto de escritura del libro diario.
 *
 * Siempre recibe la transacción de quien contabiliza: el asiento se crea o
 * se descarta junto con el cambio del documento que lo origina (recibo,
 * cobro, factura…). Nunca abre su propia transacción.
 */
@Injectable()
export class JournalService {
  async post(db: Db, draft: EntryDraft): Promise<PostedEntry> {
    validateDraft(draft);
    const date = accountingDay(draft.date);
    const fiscalYear = date.getUTCFullYear();
    const entryType = draft.entryType ?? 'standard';

    const resolver = new AccountResolver(db, draft.estateId);
    const accountIds: string[] = [];
    for (const line of draft.lines) {
      accountIds.push(await resolver.resolve(line.account));
    }

    await this.ensureFiscalYear(db, draft.estateId, fiscalYear);
    const number = await this.nextNumber(db, draft.estateId, fiscalYear);

    return db.journalEntry.create({
      data: {
        estateId: draft.estateId,
        fiscalYear,
        number,
        date,
        entryType,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId ?? null,
        concept: draft.concept.trim().slice(0, 255),
        reference: draft.reference ?? null,
        reversesEntryId: draft.reversesEntryId ?? null,
        importBatchId: draft.importBatchId ?? null,
        createdByUserId: draft.createdByUserId ?? null,
        lines: {
          createMany: {
            data: draft.lines.map((line, index) => ({
              lineNo: index + 1,
              // La base de datos sobrescribe estas cuatro con las del asiento.
              estateId: draft.estateId,
              date,
              fiscalYear,
              entryType,
              accountId: accountIds[index],
              debit: fromCents(line.debit ?? 0),
              credit: fromCents(line.credit ?? 0),
              concept: line.concept?.slice(0, 255) ?? null,
              propertyId: line.propertyId ?? null,
              supplierId: line.supplierId ?? null,
              costCentreId: line.costCentreId ?? null,
              receiptId: line.receiptId ?? null,
              supplierInvoiceId: line.supplierInvoiceId ?? null,
            })),
          },
        },
      },
      select: { id: true, fiscalYear: true, number: true },
    });
  }

  /**
   * Contraasiento: el espejo exacto del original (mismas cuentas y
   * dimensiones, debe y haber intercambiados). La base de datos comprueba
   * que lo sea y que el original no esté ya revertido.
   */
  async reverse(
    db: Db,
    entryId: string,
    opts: { date: Date; concept?: string; createdByUserId?: string },
  ): Promise<PostedEntry> {
    const original = await db.journalEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        estateId: true,
        number: true,
        fiscalYear: true,
        entryType: true,
        sourceType: true,
        sourceId: true,
        concept: true,
        reversesEntryId: true,
        reversedBy: { select: { id: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          select: {
            accountId: true,
            debit: true,
            credit: true,
            concept: true,
            propertyId: true,
            supplierId: true,
            costCentreId: true,
            receiptId: true,
            supplierInvoiceId: true,
          },
        },
      },
    });
    if (!original) throw new NotFoundException('El asiento no existe.');
    if (original.reversedBy) {
      throw new UnprocessableEntityException(
        `El asiento ${original.fiscalYear}/${original.number} ya está revertido.`,
      );
    }

    const lines: LineDraft[] = original.lines.map((l) => ({
      account: { accountId: l.accountId },
      debit: toCents(l.credit),
      credit: toCents(l.debit),
      concept: l.concept ?? undefined,
      propertyId: l.propertyId ?? undefined,
      supplierId: l.supplierId ?? undefined,
      costCentreId: l.costCentreId ?? undefined,
      receiptId: l.receiptId ?? undefined,
      supplierInvoiceId: l.supplierInvoiceId ?? undefined,
    }));

    return this.post(db, {
      estateId: original.estateId,
      date: opts.date,
      entryType: original.entryType,
      sourceType: original.sourceType,
      sourceId: original.sourceId ?? undefined,
      concept:
        opts.concept ??
        `Anulación del asiento ${original.fiscalYear}/${original.number}: ${original.concept}`,
      reversesEntryId: original.id,
      createdByUserId: opts.createdByUserId,
      lines,
    });
  }

  /** El ejercicio se crea al contabilizar por primera vez en él (ver ensureFiscalYearRow). */
  ensureFiscalYear(db: Db, estateId: string, year: number): Promise<void> {
    return ensureFiscalYearRow(db, estateId, year);
  }

  /** Configuración del fondo de reserva del ejercicio (lo crea si falta). */
  async reserveConfig(
    db: Db,
    estateId: string,
    year: number,
  ): Promise<{ mode: ReserveMode; sharePct: Prisma.Decimal | null }> {
    await this.ensureFiscalYear(db, estateId, year);
    const fy = await db.fiscalYear.findUniqueOrThrow({
      where: { estateId_year: { estateId, year } },
      select: { reserveMode: true, reserveSharePct: true },
    });
    return { mode: fy.reserveMode, sharePct: fy.reserveSharePct };
  }

  /**
   * Siguiente número sin huecos (mismo patrón que la numeración de facturas
   * en admins.service.ts): el UPSERT bloquea la fila del contador hasta que
   * la transacción termina, y si la transacción falla el número se libera.
   */
  private async nextNumber(
    db: Db,
    estateId: string,
    year: number,
  ): Promise<number> {
    const rows = await db.$queryRaw<{ last_number: number }[]>`
      INSERT INTO "journal_sequences" ("estate_id", "year", "last_number")
      VALUES (${estateId}::uuid, ${year}, 1)
      ON CONFLICT ("estate_id", "year")
      DO UPDATE SET "last_number" = "journal_sequences"."last_number" + 1
      RETURNING "last_number"
    `;
    return rows[0].last_number;
  }
}
