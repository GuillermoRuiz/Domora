import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Renovar un contrato: nuevo vencimiento (obligatorio) y, si cambia con la renovación, el importe y su
 * periodicidad. Lo que no se envía se conserva.
 */
export class RenewSupplierContractDto {
  // strict: rechaza fechas de calendario inexistentes (2026-02-30), que `new Date` desplazaría en silencio.
  @IsISO8601({ strict: true })
  newEndDate!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(9999999999.99)
  costAmount?: number | null;

  @IsOptional()
  @IsIn(['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'ONE_OFF', 'OTHER'])
  costFrequency?:
    | 'MONTHLY'
    | 'QUARTERLY'
    | 'SEMIANNUAL'
    | 'ANNUAL'
    | 'ONE_OFF'
    | 'OTHER'
    | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
