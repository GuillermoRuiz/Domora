import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  Prisma,
  type ReserveAllocationRule,
  type ReserveMode,
} from '../../prisma/client';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureAccountingSettings } from '../chart/ledger-bootstrap';

const RESERVE_MODES: ReserveMode[] = [
  'none',
  'receipt_share',
  'year_end_allocation',
  'both',
];

const RESERVE_ALLOCATION_RULES: ReserveAllocationRule[] = [
  'fixed_amount',
  'pct_of_result',
  'top_up_to_legal_minimum',
];

/** Cambio parcial: cada campo que no llega se deja como está. */
export class UpdateAccountingSettingsDto {
  /** Fecha de inicio contable, AAAA-MM-DD. */
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'La fecha de inicio contable no es válida.' },
  )
  cutoverDate?: string;

  /** Modo del fondo de reserva que heredan los ejercicios nuevos (ADR, D3). */
  @IsOptional()
  @IsIn(RESERVE_MODES)
  defaultReserveMode?: ReserveMode;

  /** Parte de cada cuota ordinaria que va a la 117. null = no se separa. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultReserveSharePct?: number | null;

  /** Regla de la dotación al cierre que heredan los ejercicios nuevos (modos "dotación al cierre" y "ambos", fase 11). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(RESERVE_ALLOCATION_RULES)
  defaultReserveAllocationRule?: ReserveAllocationRule | null;

  /** Importe fijo en euros, o porcentaje del resultado, según la regla. Sin uso en "hasta el mínimo legal". */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultReserveAllocationValue?: number | null;

  /** Repercutir la comisión de las devoluciones al propietario (ADR, D8). */
  @IsOptional()
  @IsBoolean()
  returnFeeRecharge?: boolean;
}

export interface AccountingSettingsView {
  cutoverDate: string;
  defaultReserveMode: ReserveMode;
  /** Porcentaje con dos decimales, o null. */
  defaultReserveSharePct: string | null;
  defaultReserveAllocationRule: ReserveAllocationRule | null;
  /** Importe o porcentaje con dos decimales, o null. */
  defaultReserveAllocationValue: string | null;
  returnFeeRecharge: boolean;
  /** Fecha del primer asiento contabilizado, si hay alguno. */
  firstEntryDate: string | null;
  hasOpeningEntry: boolean;
  /** La fecha de corte se puede cambiar mientras no haya apertura. */
  cutoverEditable: boolean;
  /** Cuándo se confirmó "esta finca no tiene saldos previos" (fase 9) — null si no se confirmó. */
  noPriorBalancesConfirmedAt: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Configuración contable de la finca. La fecha de corte marca desde cuándo
 * lleva Domora la contabilidad: los saldos de antes entran como asiento de
 * apertura en esa fecha.
 */
@Injectable()
export class AccountingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async get(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<AccountingSettingsView> {
    this.estateAccess.assertAccess(estateId, user);
    await ensureAccountingSettings(this.prisma, estateId);
    const [settings, first, opening] = await Promise.all([
      this.prisma.accountingSettings.findUniqueOrThrow({ where: { estateId } }),
      this.prisma.journalEntry.findFirst({
        where: { estateId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.journalEntry.count({
        where: { estateId, entryType: 'opening' },
      }),
    ]);
    return {
      cutoverDate: isoDay(settings.cutoverDate),
      defaultReserveMode: settings.defaultReserveMode,
      defaultReserveSharePct:
        settings.defaultReserveSharePct?.toFixed(2) ?? null,
      defaultReserveAllocationRule: settings.defaultReserveAllocationRule,
      defaultReserveAllocationValue:
        settings.defaultReserveAllocationValue?.toFixed(2) ?? null,
      returnFeeRecharge: settings.returnFeeRecharge,
      firstEntryDate: first ? isoDay(first.date) : null,
      hasOpeningEntry: opening > 0,
      cutoverEditable: opening === 0,
      noPriorBalancesConfirmedAt: settings.noPriorBalancesConfirmedAt
        ? settings.noPriorBalancesConfirmedAt.toISOString()
        : null,
    };
  }

  /**
   * Reglas: con asiento de apertura la fecha ya no se mueve (habría que
   * rehacer la apertura), y nunca puede quedar posterior a un asiento ya
   * contabilizado (ese asiento quedaría antes del inicio contable). Moverla
   * hacia atrás, para cargar saldos de una fecha anterior, sí se puede.
   */
  async update(
    estateId: string,
    dto: UpdateAccountingSettingsDto,
    user: AuthenticatedUser,
  ): Promise<AccountingSettingsView> {
    const current = await this.get(estateId, user);

    if (
      dto.defaultReserveAllocationRule &&
      dto.defaultReserveAllocationRule !== 'top_up_to_legal_minimum' &&
      (dto.defaultReserveAllocationValue === null ||
        dto.defaultReserveAllocationValue === undefined)
    ) {
      throw new UnprocessableEntityException(
        'Esta regla de dotación necesita un importe o porcentaje.',
      );
    }

    // El fondo de reserva por defecto solo afecta a los ejercicios que se
    // creen desde ahora; cada ejercicio existente se cambia aparte.
    if (
      dto.defaultReserveMode !== undefined ||
      dto.defaultReserveSharePct !== undefined ||
      dto.defaultReserveAllocationRule !== undefined ||
      dto.defaultReserveAllocationValue !== undefined ||
      dto.returnFeeRecharge !== undefined
    ) {
      await this.prisma.accountingSettings.update({
        where: { estateId },
        data: {
          ...(dto.defaultReserveMode !== undefined
            ? { defaultReserveMode: dto.defaultReserveMode }
            : {}),
          ...(dto.defaultReserveSharePct !== undefined
            ? {
                defaultReserveSharePct:
                  dto.defaultReserveSharePct === null
                    ? null
                    : new Prisma.Decimal(dto.defaultReserveSharePct),
              }
            : {}),
          ...(dto.defaultReserveAllocationRule !== undefined
            ? { defaultReserveAllocationRule: dto.defaultReserveAllocationRule }
            : {}),
          ...(dto.defaultReserveAllocationValue !== undefined
            ? {
                defaultReserveAllocationValue:
                  dto.defaultReserveAllocationValue === null
                    ? null
                    : new Prisma.Decimal(dto.defaultReserveAllocationValue),
              }
            : {}),
          ...(dto.returnFeeRecharge !== undefined
            ? { returnFeeRecharge: dto.returnFeeRecharge }
            : {}),
        },
      });
    }

    const next = dto.cutoverDate?.slice(0, 10);
    if (!next || next === current.cutoverDate) return this.get(estateId, user);

    await this.prisma.$transaction(async (tx) => {
      // Bloquea la configuración: el trigger de asientos la lee con FOR
      // SHARE, así que nadie contabiliza con la fecha vieja mientras tanto.
      await tx.$queryRaw`SELECT 1 FROM "accounting_settings" WHERE "estate_id" = ${estateId}::uuid FOR UPDATE`;
      const [first, opening] = await Promise.all([
        tx.journalEntry.findFirst({
          where: { estateId },
          orderBy: { date: 'asc' },
          select: { date: true },
        }),
        tx.journalEntry.count({ where: { estateId, entryType: 'opening' } }),
      ]);
      if (opening > 0) {
        throw new UnprocessableEntityException(
          'Ya hay un asiento de apertura: para cambiar la fecha de inicio contable hay que rehacer los saldos iniciales.',
        );
      }
      if (first && next > isoDay(first.date)) {
        throw new UnprocessableEntityException(
          `Ya hay asientos desde el ${isoDay(first.date)}: la fecha de inicio contable no puede ser posterior.`,
        );
      }
      await tx.accountingSettings.update({
        where: { estateId },
        data: { cutoverDate: new Date(`${next}T00:00:00Z`) },
      });
    });
    return this.get(estateId, user);
  }
}
