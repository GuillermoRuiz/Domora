import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  Prisma,
  ReserveFundApplication,
  ReserveFundUseReason,
} from '../../prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalService } from '../journal/journal.service';
import { fromCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';

type Db = Prisma.TransactionClient;

/**
 * Uso del fondo de reserva (art. 9.1.f LPH): el gasto real de la obra o el
 * contrato se contabiliza aparte, como cualquier factura o nómina normal en
 * su propia 6xx (ver `SupplierPostingService`/`PayrollPostingService`) —
 * esto SOLO es la reclasificación 117 → 746 que libera el fondo por ese
 * importe, para que el gasto no distorsione el resultado del ejercicio
 * (ADR D4). Nunca se paga directamente de la 117 contra el banco.
 *
 * Motivo y referencia al acta son obligatorios (a diferencia de la política
 * de intereses, donde `meetingReference` es opcional): el fondo tiene "una
 * finalidad totalmente independiente" de los gastos ordinarios, así que la
 * traza de cumplimiento no es opcional aquí.
 */
@Injectable()
export class ReserveFundPostingService {
  constructor(private readonly journal: JournalService) {}

  async apply(
    db: Db,
    input: {
      estateId: string;
      date: Date;
      amount: Cents;
      reason: ReserveFundUseReason;
      concept: string;
      meetingReference: string;
      relatedSupplierInvoiceId?: string | null;
      relatedPayrollId?: string | null;
      userId?: string;
    },
  ): Promise<ReserveFundApplication> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new UnprocessableEntityException(
        'El importe debe ser mayor que cero.',
      );
    }
    const concept = input.concept.trim();
    if (!concept) {
      throw new UnprocessableEntityException(
        'Indica para qué se libera el fondo de reserva.',
      );
    }
    const meetingReference = input.meetingReference.trim();
    if (!meetingReference) {
      throw new UnprocessableEntityException(
        'Indica el acta que autoriza esta obra o contrato — el fondo de reserva tiene una finalidad legal tasada (art. 9.1.f LPH), no se libera sin ese respaldo.',
      );
    }
    if (input.relatedSupplierInvoiceId) {
      const invoice = await db.supplierInvoice.findFirst({
        where: { id: input.relatedSupplierInvoiceId, estateId: input.estateId },
        select: { id: true },
      });
      if (!invoice) {
        throw new NotFoundException(
          'La factura indicada no existe en esta finca.',
        );
      }
    }
    if (input.relatedPayrollId) {
      const payroll = await db.payrollRecord.findFirst({
        where: { id: input.relatedPayrollId, estateId: input.estateId },
        select: { id: true },
      });
      if (!payroll) {
        throw new NotFoundException(
          'La nómina indicada no existe en esta finca.',
        );
      }
    }

    const id = randomUUID();
    const date = accountingDay(input.date);
    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date,
      sourceType: 'reserve_use',
      sourceId: id,
      concept: `Uso del fondo de reserva: ${concept}`.slice(0, 255),
      reference: meetingReference.slice(0, 100),
      createdByUserId: input.userId,
      lines: [
        { account: { role: 'reserve_fund' }, debit: input.amount },
        { account: { role: 'reserve_applied' }, credit: input.amount },
      ],
    });
    return db.reserveFundApplication.create({
      data: {
        id,
        estateId: input.estateId,
        date,
        amount: fromCents(input.amount),
        reason: input.reason,
        concept: concept.slice(0, 255),
        meetingReference: meetingReference.slice(0, 255),
        relatedSupplierInvoiceId: input.relatedSupplierInvoiceId ?? null,
        relatedPayrollId: input.relatedPayrollId ?? null,
        entryId: entry.id,
        createdByUserId: input.userId ?? null,
      },
    });
  }

  async cancel(
    db: Db,
    id: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<ReserveFundApplication> {
    await db.$queryRaw`SELECT 1 FROM "reserve_fund_applications" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const application = await db.reserveFundApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('La liberación del fondo no existe.');
    }
    if (application.cancelledAt) {
      throw new ConflictException('Esta liberación ya está deshecha.');
    }
    const reversal = await this.journal.reverse(db, application.entryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept: `Uso del fondo de reserva deshecho: ${opts.reason}`.slice(
        0,
        255,
      ),
      createdByUserId: opts.userId,
    });
    return db.reserveFundApplication.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelReason: opts.reason.slice(0, 255),
        cancelEntryId: reversal.id,
      },
    });
  }
}
