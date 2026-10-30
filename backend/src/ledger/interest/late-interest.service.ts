import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, ReceiptStatus } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runPosting } from '../journal/journal-db-errors';
import { fromCents, toCents } from '../money';
import { ReceiptPostingService } from '../posting/receipt-posting.service';
import { dbErrorText } from '../../prisma/prisma-errors';
import {
  computeInterest,
  type InterestPolicyWindow,
  type InterestSegment,
  type PrincipalEvent,
} from './interest.rules';

type Db = Prisma.TransactionClient;

const OPEN_RECEIPT_STATUSES: ReceiptStatus[] = [
  'Pendiente',
  'Parcial',
  'Devuelto',
];

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export interface LateInterestPreviewView {
  debtReceiptNo: string;
  interestStart: string | null;
  segments: {
    from: string;
    to: string;
    days: number;
    annualRatePct: number;
    principal: number;
    amount: number;
  }[];
  total: number;
}

/**
 * Intereses de demora (fase 10 de doc/contabilidad/roadmap-partida-doble.md,
 * ADR D7): bajo demanda, nunca con un cron — la gestora elige el recibo y la
 * fecha hasta la que liquidar. `preview()` no persiste nada; `accrue()`
 * contabiliza un recibo `intereses_demora` con su propio asiento (430/769)
 * y dos garantías de base de datos por detrás: T11 (un tramo liquidado no
 * se repite) y DM100 (sin anatocismo).
 */
@Injectable()
export class LateInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly receiptPosting: ReceiptPostingService,
  ) {}

  async preview(
    estateId: string,
    receiptId: string,
    asOfDateRaw: string | undefined,
    user: AuthenticatedUser,
  ): Promise<LateInterestPreviewView> {
    this.estateAccess.assertAccess(estateId, user);
    const asOfDate = asOfDateRaw ? day(asOfDateRaw) : dayFromNow();
    const ctx = await this.loadContext(this.prisma, estateId, receiptId);
    const { segments, interestStart } = computeInterest({
      dueDate: ctx.debtReceipt.dueDate!,
      asOfDate,
      policies: ctx.policies,
      principalTimeline: ctx.principalTimeline,
      alreadyLiquidated: ctx.alreadyLiquidated,
    });
    return this.view(ctx.debtReceipt.no, interestStart, segments);
  }

  async accrue(
    estateId: string,
    receiptId: string,
    asOfDateRaw: string | undefined,
    user: AuthenticatedUser,
  ): Promise<LateInterestPreviewView & { interestReceiptId: string }> {
    this.estateAccess.assertAccess(estateId, user);
    const asOfDate = asOfDateRaw ? day(asOfDateRaw) : dayFromNow();

    try {
      return await runPosting(this.prisma, async (tx) => {
        const ctx = await this.loadContext(tx, estateId, receiptId);
        const { segments, interestStart } = computeInterest({
          dueDate: ctx.debtReceipt.dueDate!,
          asOfDate,
          policies: ctx.policies,
          principalTimeline: ctx.principalTimeline,
          alreadyLiquidated: ctx.alreadyLiquidated,
        });
        if (segments.length === 0) {
          throw new UnprocessableEntityException(
            'No hay nada que liquidar: o todavía no pasó la carencia, o ya está todo liquidado hasta esa fecha.',
          );
        }
        const totalCents = segments.reduce((s, x) => s + x.amountCents, 0);

        const periodKey = asOfDate.toISOString().slice(0, 7);
        const period = await tx.accountingPeriod.upsert({
          where: { estateId_periodKey: { estateId, periodKey } },
          update: {},
          create: {
            estateId,
            periodKey,
            label: periodKey,
            monthAbbrev: periodKey.slice(5),
          },
        });
        const property = await tx.property.findUniqueOrThrow({
          where: { id: ctx.debtReceipt.propertyId },
          select: { ref: true, staircase: true, floor: true, door: true },
        });
        const seq = await this.receiptPosting.nextNumber(
          tx,
          estateId,
          period.id,
          `${periodKey}INT`,
        );

        const interestReceipt = await this.receiptPosting.issue(tx, {
          estateId,
          periodId: period.id,
          periodKey,
          propertyId: ctx.debtReceipt.propertyId,
          no: `${periodKey.replace('-', '/')}-INT${String(seq).padStart(3, '0')}`,
          concept: `Intereses de demora · recibo ${ctx.debtReceipt.no}`,
          kind: 'intereses_demora',
          amount: totalCents,
          dueDate: asOfDate,
          method: 'Pendiente',
          manual: true,
          includeInRemesa: false,
          ownerNameSnapshot:
            property.ref ??
            [property.staircase, property.floor, property.door]
              .filter(Boolean)
              .join('-'),
          createdByUserId: user.id,
        });

        for (const segment of segments) {
          await tx.receiptInterestAccrual.create({
            data: {
              debtReceiptId: receiptId,
              interestReceiptId: interestReceipt.id,
              policyId: segment.policyId,
              fromDate: segment.from,
              toDate: segment.to,
              principalBase: fromCents(segment.principalCents),
              annualRatePct: segment.annualRatePct,
              days: segment.days,
              amount: fromCents(segment.amountCents),
            },
          });
        }

        return {
          ...this.view(ctx.debtReceipt.no, interestStart, segments),
          interestReceiptId: interestReceipt.id,
        };
      });
    } catch (error) {
      // 23P01 = exclusion_violation — carrera entre dos liquidaciones concurrentes del mismo tramo.
      if (
        error instanceof Error &&
        dbErrorText(error).includes('excl_interest_accrual_no_overlap')
      ) {
        throw new ConflictException(
          'Ese periodo ya se liquidó en otra operación: recarga y vuelve a intentarlo.',
        );
      }
      throw error;
    }
  }

  private async loadContext(db: Db, estateId: string, receiptId: string) {
    const debtReceipt = await db.accountingReceipt.findFirst({
      where: { id: receiptId, estateId },
      select: {
        id: true,
        no: true,
        propertyId: true,
        dueDate: true,
        kind: true,
        status: true,
        outstanding: true,
      },
    });
    if (!debtReceipt) {
      throw new NotFoundException(`Recibo ${receiptId} no encontrado.`);
    }
    if (debtReceipt.kind === 'intereses_demora') {
      throw new UnprocessableEntityException(
        'No se puede liquidar interés sobre un recibo que ya es de intereses (sin anatocismo).',
      );
    }
    if (!debtReceipt.dueDate) {
      throw new UnprocessableEntityException(
        'Este recibo no tiene fecha de vencimiento: no se le puede liquidar interés.',
      );
    }
    if (
      !OPEN_RECEIPT_STATUSES.includes(debtReceipt.status) ||
      Number(debtReceipt.outstanding) <= 0
    ) {
      throw new UnprocessableEntityException(
        `El recibo ${debtReceipt.no} no tiene nada pendiente: no genera intereses.`,
      );
    }

    const [policyRows, accrualRows, lines] = await Promise.all([
      db.latePaymentInterestPolicy.findMany({
        where: { estateId },
        orderBy: { validFrom: 'asc' },
        select: {
          id: true,
          annualRatePct: true,
          graceDays: true,
          validFrom: true,
          validTo: true,
        },
      }),
      db.receiptInterestAccrual.findMany({
        where: { debtReceiptId: receiptId },
        select: { fromDate: true, toDate: true },
      }),
      db.journalLine.findMany({
        where: { receiptId, account: { systemRole: 'owners_receivable' } },
        select: { debit: true, credit: true, date: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const policies: InterestPolicyWindow[] = policyRows.map((p) => ({
      id: p.id,
      annualRatePct: p.annualRatePct,
      graceDays: p.graceDays,
      validFrom: p.validFrom,
      validTo: p.validTo,
    }));

    let running = 0;
    const principalTimeline: PrincipalEvent[] = lines.map((l) => {
      running += toCents(l.debit) - toCents(l.credit);
      return { from: l.date, outstandingCents: running };
    });

    return {
      debtReceipt,
      policies,
      alreadyLiquidated: accrualRows.map((a) => ({
        from: a.fromDate,
        to: a.toDate,
      })),
      principalTimeline,
    };
  }

  private view(
    debtReceiptNo: string,
    interestStart: Date | null,
    segments: InterestSegment[],
  ): LateInterestPreviewView {
    return {
      debtReceiptNo,
      interestStart: interestStart ? isoDay(interestStart) : null,
      segments: segments.map((s) => ({
        from: isoDay(s.from),
        to: isoDay(s.to),
        days: s.days,
        annualRatePct: Number(s.annualRatePct),
        principal: fromCents(s.principalCents).toNumber(),
        amount: fromCents(s.amountCents).toNumber(),
      })),
      total: fromCents(
        segments.reduce((sum, s) => sum + s.amountCents, 0),
      ).toNumber(),
    };
  }
}

function dayFromNow(): Date {
  return day(new Date().toISOString());
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
