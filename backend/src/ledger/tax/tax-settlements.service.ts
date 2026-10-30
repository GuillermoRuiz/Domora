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
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { runPosting } from '../journal/journal-db-errors';
import { TaxSettlementPostingService } from '../posting/tax-settlement-posting.service';
import { toCents } from '../money';

export class CreateTaxSettlementDto {
  @IsIn(['modelo111', 'seguridad_social'])
  kind!: 'modelo111' | 'seguridad_social';

  /** '2026-T1' para el 111; '2026-03' para la Seguridad Social. */
  @IsString()
  @MaxLength(7)
  period!: string;

  @IsISO8601(
    { strict: true },
    { message: 'La fecha del ingreso no es válida.' },
  )
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  /** NRC o referencia del justificante. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;
}

export class UndoTaxSettlementDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}

/** Ingresos del 111 y pagos a la Seguridad Social: acceso, euros y transacción. */
@Injectable()
export class TaxSettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly posting: TaxSettlementPostingService,
  ) {}

  async list(
    estateId: string,
    opts: { year?: number },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const rows = await this.prisma.taxSettlement.findMany({
      where: {
        estateId,
        ...(opts.year ? { period: { startsWith: `${opts.year}-` } } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        bankAccount: { select: { alias: true } },
        entry: { select: { number: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      period: t.period,
      date: t.date,
      amount: Number(t.amount),
      reference: t.reference,
      bankAccountAlias: t.bankAccount?.alias ?? null,
      entryNumber: t.entry.number,
      status: t.undoneAt ? 'Deshecho' : 'Vigente',
      undoReason: t.undoReason,
    }));
  }

  async create(
    estateId: string,
    dto: CreateTaxSettlementDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
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
    return runPosting(this.prisma, (tx) =>
      this.posting.settle(tx, {
        estateId,
        kind: dto.kind,
        period: dto.period,
        date: new Date(`${dto.date.slice(0, 10)}T00:00:00Z`),
        amount: toCents(dto.amount),
        bankAccountId: dto.bankAccountId ?? null,
        reference: dto.reference?.trim() || null,
        userId: user.id,
      }),
    );
  }

  async undo(id: string, dto: UndoTaxSettlementDto, user: AuthenticatedUser) {
    const settlement = await this.prisma.taxSettlement.findUnique({
      where: { id },
      select: { estateId: true },
    });
    if (!settlement) throw new NotFoundException('El ingreso no existe.');
    this.estateAccess.assertAccess(settlement.estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.posting.undo(tx, id, { reason: dto.reason, userId: user.id }),
    );
  }
}
