import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  PayMethod,
  PayrollKind,
  PayrollRecord,
  Prisma,
} from '../../prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalService } from '../journal/journal.service';
import { ensureDefaultBankAccount } from '../chart/ledger-bootstrap';
import { fromCents, toCents, type Cents } from '../money';
import { accountingDay } from './draft-validation';
import type { LineDraft } from './posting.types';
import { collectionAccountRole } from './rules/receipt.rules';

type Db = Prisma.TransactionClient;

export interface RegisterPayrollInput {
  estateId: string;
  staffMemberId: string;
  /** AAAA-MM. */
  period: string;
  kind?: PayrollKind;
  /** Fecha contable. Sin ella, el último día del mes. */
  accrualDate?: Date;
  gross: Cents;
  employeeSs: Cents;
  employerSs: Cents;
  irpf: Cents;
  notes?: string;
  createdByUserId?: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Último día del mes AAAA-MM, a medianoche UTC. */
export function lastDayOf(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
}

/**
 * Nóminas en el diario (fase 7c). Los importes vienen de la gestoría
 * laboral: Domora no calcula nóminas (ADR, D23), las contabiliza.
 *
 * - **Registrar**: Debe 640 bruto y 642 cuota patronal / Haber 476 cuotas
 *   obrera y patronal, 4751 IRPF y 465 neto.
 * - **Pagar**: Debe 465 / Haber banco o caja.
 * - **Deshacer el pago** y **anular** (solo sin pagar): contraasientos.
 */
@Injectable()
export class PayrollPostingService {
  constructor(private readonly journal: JournalService) {}

  async register(db: Db, input: RegisterPayrollInput): Promise<PayrollRecord> {
    if (!PERIOD.test(input.period)) {
      throw new UnprocessableEntityException(
        'El mes de la nómina debe tener el formato AAAA-MM.',
      );
    }
    for (const [value, label] of [
      [input.gross, 'El bruto'],
      [input.employeeSs, 'La cuota obrera'],
      [input.employerSs, 'La cuota patronal'],
      [input.irpf, 'La retención'],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new UnprocessableEntityException(
          `${label} no es un importe válido.`,
        );
      }
    }
    if (input.gross <= 0)
      throw new UnprocessableEntityException(
        'El bruto debe ser mayor que cero.',
      );
    const net = input.gross - input.employeeSs - input.irpf;
    if (net < 0) {
      throw new UnprocessableEntityException(
        'La cuota obrera y la retención no pueden superar el bruto.',
      );
    }
    const staff = await db.staffMember.findUnique({
      where: { id: input.staffMemberId },
      select: { estateId: true, fullName: true },
    });
    if (!staff || staff.estateId !== input.estateId) {
      throw new NotFoundException('El empleado no existe en esta finca.');
    }
    const kind = input.kind ?? 'mensual';
    const duplicate = await db.payrollRecord.findFirst({
      where: {
        staffMemberId: input.staffMemberId,
        period: input.period,
        kind,
        status: { not: 'Anulada' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya hay una nómina ${kind} de ${input.period} para ${staff.fullName}.`,
      );
    }

    const id = randomUUID();
    const accrualDate = accountingDay(
      input.accrualDate ?? lastDayOf(input.period),
    );
    const record = await db.payrollRecord.create({
      data: {
        id,
        estateId: input.estateId,
        staffMemberId: input.staffMemberId,
        period: input.period,
        kind,
        accrualDate,
        grossSalary: fromCents(input.gross),
        employeeSs: fromCents(input.employeeSs),
        employerSs: fromCents(input.employerSs),
        irpfWithholding: fromCents(input.irpf),
        netPay: fromCents(net),
        notes: input.notes?.slice(0, 255) ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    const lines: LineDraft[] = [
      { account: { role: 'wages' }, debit: input.gross },
    ];
    if (input.employerSs > 0)
      lines.push({ account: { role: 'employer_ss' }, debit: input.employerSs });
    if (input.employeeSs + input.employerSs > 0) {
      lines.push({
        account: { role: 'social_security_payable' },
        credit: input.employeeSs + input.employerSs,
      });
    }
    if (input.irpf > 0)
      lines.push({
        account: { role: 'withholding_payable' },
        credit: input.irpf,
        concept: 'Retención IRPF',
      });
    if (net > 0)
      lines.push({ account: { role: 'salaries_payable' }, credit: net });

    const entry = await this.journal.post(db, {
      estateId: input.estateId,
      date: accrualDate,
      sourceType: 'payroll',
      sourceId: id,
      concept:
        `Nómina ${kind === 'mensual' ? '' : `${kind} `}${input.period} · ${staff.fullName}`.slice(
          0,
          255,
        ),
      createdByUserId: input.createdByUserId,
      lines,
    });
    return db.payrollRecord.update({
      where: { id: record.id },
      data: { entryId: entry.id },
    });
  }

  async pay(
    db: Db,
    payrollId: string,
    opts: {
      date: Date;
      method: PayMethod;
      bankAccountId?: string | null;
      userId?: string;
    },
  ): Promise<PayrollRecord> {
    const record = await this.lock(db, payrollId);
    if (record.status !== 'Registrada') {
      throw new ConflictException(
        record.status === 'Pagada'
          ? 'Esta nómina ya está pagada.'
          : 'Esta nómina está anulada.',
      );
    }
    const net = toCents(record.netPay);
    if (net === 0) {
      throw new ConflictException('Esta nómina no tiene neto que pagar.');
    }
    const isCash = collectionAccountRole(opts.method) === 'cash';
    const bankAccountId = isCash
      ? null
      : (opts.bankAccountId ??
        (await ensureDefaultBankAccount(db, record.estateId)));
    const date = accountingDay(opts.date);
    const entry = await this.journal.post(db, {
      estateId: record.estateId,
      date,
      sourceType: 'payroll',
      sourceId: record.id,
      concept: `Pago de la nómina ${record.period}`,
      createdByUserId: opts.userId,
      lines: [
        { account: { role: 'salaries_payable' }, debit: net },
        {
          account: isCash
            ? { role: 'cash' }
            : { bankAccountId: bankAccountId! },
          credit: net,
        },
      ],
    });
    return db.payrollRecord.update({
      where: { id: record.id },
      data: {
        status: 'Pagada',
        paidDate: date,
        paymentEntryId: entry.id,
        paymentBankId: bankAccountId,
      },
    });
  }

  async undoPayment(
    db: Db,
    payrollId: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<PayrollRecord> {
    const record = await this.lock(db, payrollId);
    if (record.status !== 'Pagada' || !record.paymentEntryId) {
      throw new ConflictException('Esta nómina no está pagada.');
    }
    await this.journal.reverse(db, record.paymentEntryId, {
      date: accountingDay(opts.date ?? new Date()),
      concept:
        `Pago de la nómina ${record.period} deshecho: ${opts.reason}`.slice(
          0,
          255,
        ),
      createdByUserId: opts.userId,
    });
    return db.payrollRecord.update({
      where: { id: record.id },
      data: {
        status: 'Registrada',
        paidDate: null,
        paymentEntryId: null,
        paymentBankId: null,
      },
    });
  }

  async cancel(
    db: Db,
    payrollId: string,
    opts: { reason: string; date?: Date; userId?: string },
  ): Promise<PayrollRecord> {
    const record = await this.lock(db, payrollId);
    if (record.status === 'Anulada')
      throw new ConflictException('Esta nómina ya está anulada.');
    if (record.status === 'Pagada') {
      throw new ConflictException(
        'Esta nómina está pagada: deshaz antes el pago.',
      );
    }
    const reversal = await this.journal.reverse(db, record.entryId!, {
      date: accountingDay(opts.date ?? new Date()),
      concept: `Anulación de la nómina ${record.period}: ${opts.reason}`.slice(
        0,
        255,
      ),
      createdByUserId: opts.userId,
    });
    return db.payrollRecord.update({
      where: { id: record.id },
      data: {
        status: 'Anulada',
        cancelEntryId: reversal.id,
        cancelledAt: new Date(),
        cancelReason: opts.reason.slice(0, 255),
      },
    });
  }

  private async lock(db: Db, payrollId: string): Promise<PayrollRecord> {
    await db.$queryRaw`SELECT 1 FROM "payroll_records" WHERE "id" = ${payrollId}::uuid FOR UPDATE`;
    const record = await db.payrollRecord.findUnique({
      where: { id: payrollId },
    });
    if (!record) throw new NotFoundException('La nómina no existe.');
    return record;
  }
}
