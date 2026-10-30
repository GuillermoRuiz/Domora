import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ReserveFundUseReason } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { runPosting } from '../journal/journal-db-errors';
import { ReserveFundPostingService } from '../posting/reserve-fund-posting.service';
import { toCents } from '../money';

const RESERVE_FUND_USE_REASONS: ReserveFundUseReason[] = [
  'conservacion',
  'reparacion',
  'rehabilitacion',
  'accesibilidad',
  'eficiencia_energetica',
  'seguro_danos',
  'mantenimiento_permanente',
  'otro',
];

export class CreateReserveFundApplicationDto {
  @IsISO8601({ strict: true }, { message: 'La fecha no es válida.' })
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsIn(RESERVE_FUND_USE_REASONS, {
    message: 'La finalidad no es una de las que permite el art. 9.1.f LPH.',
  })
  reason!: ReserveFundUseReason;

  @IsString()
  @MinLength(3, { message: 'Indica para qué se libera el fondo de reserva.' })
  @MaxLength(255)
  concept!: string;

  @IsString()
  @MinLength(3, {
    message: 'Indica el acta que autoriza esta obra o contrato.',
  })
  @MaxLength(255)
  meetingReference!: string;

  @IsOptional()
  @IsUUID()
  relatedSupplierInvoiceId?: string;

  @IsOptional()
  @IsUUID()
  relatedPayrollId?: string;
}

export class CancelReserveFundApplicationDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}

/**
 * Uso del fondo de reserva (art. 9.1.f LPH) — ver el comentario de clase de
 * `ReserveFundPostingService` para la mecánica contable (117 → 746).
 */
@Injectable()
export class ReserveFundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly posting: ReserveFundPostingService,
  ) {}

  async list(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const rows = await this.prisma.reserveFundApplication.findMany({
      where: { estateId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        entry: { select: { number: true } },
        relatedSupplierInvoice: { select: { number: true } },
        relatedPayroll: { select: { period: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      amount: Number(r.amount),
      reason: r.reason,
      concept: r.concept,
      meetingReference: r.meetingReference,
      relatedSupplierInvoiceNumber: r.relatedSupplierInvoice?.number ?? null,
      relatedPayrollPeriod: r.relatedPayroll?.period ?? null,
      entryNumber: r.entry.number,
      status: r.cancelledAt ? 'Deshecha' : 'Vigente',
      cancelReason: r.cancelReason,
    }));
  }

  async create(
    estateId: string,
    dto: CreateReserveFundApplicationDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.posting.apply(tx, {
        estateId,
        date: new Date(`${dto.date.slice(0, 10)}T00:00:00Z`),
        amount: toCents(dto.amount),
        reason: dto.reason,
        concept: dto.concept,
        meetingReference: dto.meetingReference,
        relatedSupplierInvoiceId: dto.relatedSupplierInvoiceId ?? null,
        relatedPayrollId: dto.relatedPayrollId ?? null,
        userId: user.id,
      }),
    );
  }

  async cancel(
    id: string,
    dto: CancelReserveFundApplicationDto,
    user: AuthenticatedUser,
  ) {
    const application = await this.prisma.reserveFundApplication.findUnique({
      where: { id },
      select: { estateId: true },
    });
    if (!application) {
      throw new NotFoundException('La liberación del fondo no existe.');
    }
    this.estateAccess.assertAccess(application.estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.posting.cancel(tx, id, { reason: dto.reason, userId: user.id }),
    );
  }
}
