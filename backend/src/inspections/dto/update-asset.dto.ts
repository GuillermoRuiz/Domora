import { AssetOperationalStatus } from '../../prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

const OPERATIONAL_STATUSES = Object.values(AssetOperationalStatus);

/**
 * Edición parcial de una instalación. Lo que no viene no se toca; en los
 * campos opcionales, `null` lo borra (p. ej. quitar el proveedor).
 */
export class UpdateAssetDto {
  // Nombre, tipo y estado son obligatorios: se pueden omitir, pero no poner a `null` (400).
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  manufacturer?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @OptionalButNotNull()
  @IsIn(OPERATIONAL_STATUSES)
  operationalStatus?: AssetOperationalStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string | null;
}
