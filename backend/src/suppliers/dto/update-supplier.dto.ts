import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaxIdCountry } from '../../prisma/client';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

const TAX_ID_COUNTRIES: TaxIdCountry[] = ['ES', 'PT', 'FR', 'DE', 'IT', 'AD'];
const STATUSES = ['Activo', 'Baja'] as const;

export class UpdateSupplierDto {
  // Nombre, categoría, estado y 347 son obligatorios: se pueden omitir, pero no poner a `null` (400).
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
  @IsIn(TAX_ID_COUNTRIES)
  taxIdCountry?: TaxIdCountry;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;

  @OptionalButNotNull()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  /** Fuera del 347 por el art. 33.5 del RGAT (suministros y seguros de elementos comunes). */
  @OptionalButNotNull()
  @IsBoolean()
  excludedFrom347?: boolean;
}
