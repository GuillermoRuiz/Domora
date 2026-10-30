import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

export class CreateSupplierVisitDto {
  /** Fecha y hora de la visita (ISO 8601). */
  @IsDateString()
  scheduledAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  purpose!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsUUID()
  issueId?: string;
}

/** Edición parcial de una visita planificada. `null` en notas, instalación o incidencia las borra. */
export class UpdateSupplierVisitDto {
  // Fecha y motivo son obligatorios: se pueden omitir, pero no poner a `null`.
  @OptionalButNotNull()
  @IsDateString()
  scheduledAt?: string;

  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  purpose?: string;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUUID()
  assetId?: string | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUUID()
  issueId?: string | null;
}

/** Cierre de una visita (realizada o cancelada): las notas se añaden a las que ya tuviera. */
export class CloseSupplierVisitDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
