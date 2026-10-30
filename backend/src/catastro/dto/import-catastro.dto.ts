import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OwnerPropertyType, ViaType } from '../../prisma/client';

const PROPERTY_TYPES = Object.values(OwnerPropertyType);
const VIA_TYPES = Object.values(ViaType);

/** Una unidad ya revisada (y posiblemente editada) por el gestor. */
export class ImportCatastroUnitDto {
  @Matches(/^[0-9A-Z]{20}$/, {
    message:
      'La referencia catastral de cada unidad debe tener 20 caracteres (mayúsculas y dígitos).',
  })
  cadastralReference!: string;

  @IsIn(PROPERTY_TYPES)
  type!: OwnerPropertyType;

  @IsOptional()
  @IsIn(VIA_TYPES)
  viaType?: ViaType | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  viaName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  streetNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  streetNumberSuffix?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  block?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  staircase?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  floor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  door?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  municipality?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string | null;

  /** Decimal(8,2) en BD: 999999.99 es el máximo representable. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999.99)
  builtAreaM2?: number | null;

  /** Mismo rango que `chk_property_participation_quota`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  participationQuota?: number | null;
}

export class ImportCatastroDto {
  /** Referencia de la parcela (14 caracteres); se guarda en la finca si no tenía. */
  @IsOptional()
  @Matches(/^[0-9A-Z]{14}$/, {
    message:
      'La referencia de la parcela debe tener 14 caracteres (mayúsculas y dígitos).',
  })
  parcelReference?: string;

  /** Momento en que se consultó el Catastro (para citar la fecha de acceso). */
  @IsOptional()
  @IsISO8601()
  fetchedAt?: string;

  // Tope generoso pero finito: un edificio grande con garajes y trasteros
  // ronda unos pocos cientos de unidades (el mayor caso probado: 204).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportCatastroUnitDto)
  units!: ImportCatastroUnitDto[];
}
