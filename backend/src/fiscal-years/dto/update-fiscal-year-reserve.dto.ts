import {
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ReserveAllocationRule, ReserveMode } from '../../prisma/client';

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

/** Configuración del fondo de reserva de un ejercicio (ADR, D3). */
export class UpdateFiscalYearReserveDto {
  @IsIn(RESERVE_MODES)
  reserveMode!: ReserveMode;

  /** Porcentaje de cada cuota ordinaria que va a la 117 (modos "por recibo" y "ambos"). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  reserveSharePct?: number | null;

  /** Regla de la dotación al cierre (modos "dotación al cierre" y "ambos", fase 11). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(RESERVE_ALLOCATION_RULES)
  reserveAllocationRule?: ReserveAllocationRule | null;

  /** Importe fijo en euros, o porcentaje del resultado, según la regla. Sin uso en "hasta el mínimo legal". */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reserveAllocationValue?: number | null;
}
