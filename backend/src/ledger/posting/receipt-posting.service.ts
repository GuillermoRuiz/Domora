import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  AccountingReceipt,
  PayMethod,
  Prisma,
  ReceiptKind,
  TaxIdCountry,
} from '../../prisma/client';
import { AccountResolver } from '../journal/account-resolver';
import { JournalService } from '../journal/journal.service';
import { fromCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';
import { receiptAccrualDate, receiptCreditLines } from './rules/receipt.rules';

type Db = Prisma.TransactionClient;

export interface IssueReceiptInput {
  estateId: string;
  periodId: string;
  periodKey: string;
  propertyId: string;
  no: string;
  concept: string;
  kind: ReceiptKind;
  amount: Cents;
  dueDate?: Date | null;
  method: PayMethod;
  manual: boolean;
  includeInRemesa?: boolean;
  ownerUserId?: string | null;
  mandateId?: string | null;
  ownerNameSnapshot?: string | null;
  ownerTaxIdSnapshot?: string | null;
  ownerTaxIdCountrySnapshot?: TaxIdCountry | null;
  ibanSnapshot?: string | null;
  /** Fecha de emisión (documento). Por defecto, hoy. */
  date?: Date;
  /** Actual emission instant. Imports of pre-existing documents explicitly pass null. */
  issuedAt?: Date | null;
  createdByUserId?: string;
}

/**
 * Contabilización de los recibos: el único sitio que emite, cobra, devuelve
 * y anula. Cada operación deja el recibo y su partida abierta de la 430
 * cuadrados en la misma transacción; la base de datos lo comprueba al
 * confirmar (migración ledger_receipts).
 */
@Injectable()
export class ReceiptPostingService {
  constructor(private readonly journal: JournalService) {}

  /**
   * Siguiente número de una serie (periodo, o periodo + "M" para manuales).
   * Arranca después de los recibos que ya tenga el periodo, para no chocar
   * con numeraciones anteriores al contador.
   */
  async nextNumber(
    db: Db,
    estateId: string,
    periodId: string,
    series: string,
  ): Promise<number> {
    const rows = await db.$queryRaw<{ last: number }[]>`
      INSERT INTO "receipt_sequences" ("estate_id", "series", "last")
      VALUES (
        ${estateId}::uuid, ${series},
        (SELECT count(*)::int + 1 FROM "receipts" WHERE "period_id" = ${periodId}::uuid)
      )
      ON CONFLICT ("estate_id", "series")
      DO UPDATE SET "last" = "receipt_sequences"."last" + 1
      RETURNING "last"
    `;
    return rows[0].last;
  }

  /**
   * Emite un recibo: lo crea con su desglose y su asiento de emisión
   * (Debe 430 del recibo / Haber cuota, derrama, reserva…), fechado al
   * inicio del periodo o a la fecha de corte si es posterior.
   */
  async issue(db: Db, input: IssueReceiptInput): Promise<AccountingReceipt> {
    const settings = await db.accountingSettings.findUnique({
      where: { estateId: input.estateId },
      select: { cutoverDate: true },
    });
    if (!settings) {
      throw new UnprocessableEntityException(
        'La finca no tiene fecha de inicio contable: configúrala antes de emitir recibos.',
      );
    }
    const accrualDate = receiptAccrualDate(
      input.periodKey,
      settings.cutoverDate,
    );
    const originYear = Number(input.periodKey.slice(0, 4));
    const reserve = await this.journal.reserveConfig(
      db,
      input.estateId,
      accrualDate.getUTCFullYear(),
    );
    const credits = receiptCreditLines(input.kind, input.amount, reserve);

    const resolver = new AccountResolver(db, input.estateId);
    const creditAccounts: string[] = [];
    for (const c of credits)
      creditAccounts.push(await resolver.resolve({ role: c.role }));

    const receipt = await db.accountingReceipt.create({
      data: {
        estateId: input.estateId,
        no: input.no,
        periodId: input.periodId,
        propertyId: input.propertyId,
        ownerUserId: input.ownerUserId ?? null,
        mandateId: input.mandateId ?? null,
        concept: input.concept,
        kind: input.kind,
        amount: fromCents(input.amount),
        outstanding: fromCents(input.amount),
        accrualDate,
        originYear,
        dueDate: input.dueDate ?? null,
        status: 'Pendiente',
        issuedAt: input.issuedAt === undefined ? new Date() : input.issuedAt,
        date: input.date ?? new Date(),
        method: input.method,
        manual: input.manual,
        includeInRemesa: input.includeInRemesa ?? true,
        ownerNameSnapshot: input.ownerNameSnapshot ?? null,
        ownerTaxIdSnapshot: input.ownerTaxIdSnapshot ?? null,
        ownerTaxIdCountrySnapshot: input.ownerTaxIdCountrySnapshot ?? null,
        ibanSnapshot: input.ibanSnapshot ?? null,
        lines: {
          createMany: {
            data: credits.map((c, i) => ({
              lineNo: i + 1,
              accountId: creditAccounts[i],
              amount: fromCents(c.amount),
              concept: c.concept,
            })),
          },
        },
      },
    });

    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date: accrualDate,
      sourceType: 'receipt_issue',
      sourceId: receipt.id,
      concept: `Recibo ${input.no} · ${input.concept}`,
      createdByUserId: input.createdByUserId,
      lines: [
        {
          account: { role: 'owners_receivable' },
          debit: input.amount,
          propertyId: input.propertyId,
          receiptId: receipt.id,
        },
        ...credits.map((c, i) => ({
          account: { accountId: creditAccounts[i] },
          credit: c.amount,
          concept: c.concept,
        })),
      ],
    });

    return db.accountingReceipt.update({
      where: { id: receipt.id },
      data: { issueEntryId: entry.id },
    });
  }

  /**
   * Marca como devuelto un recibo que NO llegó a cobrarse: el banco rechazó
   * el adeudo antes del cargo, así que no hay dinero que mover y solo cambia
   * el estado (sigue debiéndose entero). Si el recibo tiene cobros, el
   * dinero sí entró: eso es una devolución del cobro
   * (CollectionPostingService.returnCollection), con su asiento.
   */
  async markReturned(
    db: Db,
    receiptId: string,
    opts: {
      returnCode?: string | null;
      returnReason?: string | null;
      createdByUserId?: string;
    },
  ): Promise<AccountingReceipt> {
    const receipt = await this.lockReceipt(db, receiptId);
    if (receipt.status === 'Anulado') {
      throw new ConflictException(`El recibo ${receipt.no} está anulado.`);
    }
    if (!receipt.outstanding.equals(receipt.amount)) {
      throw new ConflictException(
        `El recibo ${receipt.no} tiene cobros: registra la devolución del cobro, no del recibo.`,
      );
    }
    return db.accountingReceipt.update({
      where: { id: receipt.id },
      data: {
        status: 'Devuelto',
        method: 'Devolucion',
        returnCode: opts.returnCode ?? null,
        returnReason: opts.returnReason ?? null,
        date: new Date(),
      },
    });
  }

  /**
   * Anula un recibo emitido por error: contraasiento de la emisión. Solo si
   * no tiene ningún cobro y no está en una remesa enviada al banco (se
   * cobraría igualmente). Para corregir un recibo cobrado: deshacer el
   * cobro, anular y emitir otro (ADR, D19).
   */
  async cancel(
    db: Db,
    receiptId: string,
    opts: { reason: string; date?: Date; cancelledByUserId?: string },
  ): Promise<AccountingReceipt> {
    const receipt = await this.lockReceipt(db, receiptId);
    if (receipt.status === 'Anulado') {
      throw new ConflictException(`El recibo ${receipt.no} ya está anulado.`);
    }
    // Sin nada cobrado: pendiente, o devuelto sin volver a cobrar.
    if (
      (receipt.status !== 'Pendiente' && receipt.status !== 'Devuelto') ||
      !receipt.outstanding.equals(receipt.amount)
    ) {
      throw new ConflictException(
        `El recibo ${receipt.no} tiene cobros: deshaz el cobro antes de anularlo.`,
      );
    }
    const inRemesa = await db.remesaLine.count({
      where: {
        receiptId: receipt.id,
        status: 'Pendiente',
        remesa: { status: { in: ['Borrador', 'Presentada'] } },
      },
    });
    if (inRemesa > 0) {
      throw new ConflictException(
        `El recibo ${receipt.no} está en una remesa enviada al banco: espera al cobro o a la devolución.`,
      );
    }
    if (!receipt.issueEntryId) {
      throw new ConflictException(
        `El recibo ${receipt.no} no tiene asiento de emisión.`,
      );
    }
    const reversal = await this.journal.reverse(db, receipt.issueEntryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept: `Anulación del recibo ${receipt.no}: ${opts.reason}`.slice(
        0,
        255,
      ),
      createdByUserId: opts.cancelledByUserId,
    });
    return db.accountingReceipt.update({
      where: { id: receipt.id },
      data: {
        status: 'Anulado',
        outstanding: fromCents(0),
        cancelEntryId: reversal.id,
        cancelledAt: new Date(),
        cancelledByUserId: opts.cancelledByUserId ?? null,
        cancelReason: opts.reason.slice(0, 255),
      },
    });
  }

  /** Bloquea la fila del recibo: dos cobros simultáneos no leen el mismo pendiente. */
  private async lockReceipt(
    db: Db,
    receiptId: string,
  ): Promise<AccountingReceipt> {
    await db.$queryRaw`SELECT 1 FROM "receipts" WHERE "id" = ${receiptId}::uuid FOR UPDATE`;
    return db.accountingReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  }
}
