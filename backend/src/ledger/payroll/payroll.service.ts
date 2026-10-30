import { Injectable, NotFoundException } from '@nestjs/common';
import type { PayrollRecord } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { runPosting } from '../journal/journal-db-errors';
import { PayrollPostingService } from '../posting/payroll-posting.service';
import { toCents } from '../money';
import type {
  CreatePayrollDto,
  PayPayrollDto,
  PayrollReasonDto,
} from './payroll.dto';

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

type PayrollWithStaff = PayrollRecord & {
  staffMember: {
    fullName: string;
    nationalId: string | null;
    position: string;
  };
};

function view(p: PayrollWithStaff) {
  return {
    id: p.id,
    staffMemberId: p.staffMemberId,
    staffName: p.staffMember.fullName,
    staffNationalId: p.staffMember.nationalId,
    position: p.staffMember.position,
    period: p.period,
    kind: p.kind,
    accrualDate: p.accrualDate,
    grossSalary: Number(p.grossSalary),
    employeeSs: Number(p.employeeSs),
    employerSs: Number(p.employerSs),
    irpfWithholding: Number(p.irpfWithholding),
    netPay: Number(p.netPay),
    /** Lo que cuesta a la comunidad: bruto más cuota patronal. */
    totalCost: Number(p.grossSalary) + Number(p.employerSs),
    status: p.status,
    paidDate: p.paidDate,
    cancelReason: p.cancelReason,
    notes: p.notes,
  };
}

const STAFF = {
  staffMember: { select: { fullName: true, nationalId: true, position: true } },
} as const;

/** Casos de uso de las nóminas: acceso, euros → céntimos y transacción. */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly posting: PayrollPostingService,
  ) {}

  async list(
    estateId: string,
    opts: { year?: number },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const rows = await this.prisma.payrollRecord.findMany({
      where: {
        estateId,
        ...(opts.year ? { period: { startsWith: `${opts.year}-` } } : {}),
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      include: STAFF,
      take: 1000,
    });
    return rows.map(view);
  }

  async create(
    estateId: string,
    dto: CreatePayrollDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const record = await runPosting(this.prisma, (tx) =>
      this.posting.register(tx, {
        estateId,
        staffMemberId: dto.staffMemberId,
        period: dto.period,
        kind: dto.kind,
        accrualDate: dto.accrualDate ? day(dto.accrualDate) : undefined,
        gross: toCents(dto.grossSalary),
        employeeSs: toCents(dto.employeeSs),
        employerSs: toCents(dto.employerSs),
        irpf: toCents(dto.irpfWithholding),
        notes: dto.notes,
        createdByUserId: user.id,
      }),
    );
    return this.load(record.id);
  }

  async pay(payrollId: string, dto: PayPayrollDto, user: AuthenticatedUser) {
    const estateId = await this.findOwn(payrollId, user);
    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({
        where: { id: dto.bankAccountId, estateId, closedAt: null },
        select: { id: true },
      });
      if (!bank)
        throw new NotFoundException(
          'La cuenta bancaria no existe en esta finca o está cerrada.',
        );
    }
    await runPosting(this.prisma, (tx) =>
      this.posting.pay(tx, payrollId, {
        date: day(dto.date),
        method: dto.method,
        bankAccountId: dto.bankAccountId ?? null,
        userId: user.id,
      }),
    );
    return this.load(payrollId);
  }

  async undoPayment(
    payrollId: string,
    dto: PayrollReasonDto,
    user: AuthenticatedUser,
  ) {
    await this.findOwn(payrollId, user);
    await runPosting(this.prisma, (tx) =>
      this.posting.undoPayment(tx, payrollId, {
        reason: dto.reason,
        userId: user.id,
      }),
    );
    return this.load(payrollId);
  }

  async cancel(
    payrollId: string,
    dto: PayrollReasonDto,
    user: AuthenticatedUser,
  ) {
    await this.findOwn(payrollId, user);
    await runPosting(this.prisma, (tx) =>
      this.posting.cancel(tx, payrollId, {
        reason: dto.reason,
        userId: user.id,
      }),
    );
    return this.load(payrollId);
  }

  private async findOwn(
    payrollId: string,
    user: AuthenticatedUser,
  ): Promise<string> {
    const record = await this.prisma.payrollRecord.findUnique({
      where: { id: payrollId },
      select: { estateId: true },
    });
    if (!record) throw new NotFoundException('La nómina no existe.');
    this.estateAccess.assertAccess(record.estateId, user);
    return record.estateId;
  }

  private async load(id: string) {
    return view(
      await this.prisma.payrollRecord.findUniqueOrThrow({
        where: { id },
        include: STAFF,
      }),
    );
  }
}
