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

const TAX_ID_COUNTRIES: TaxIdCountry[] = ['ES', 'PT', 'FR', 'DE', 'IT', 'AD'];

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

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

  /** Fuera del 347 por el art. 33.5 del RGAT (suministros y seguros de elementos comunes). */
  @IsOptional()
  @IsBoolean()
  excludedFrom347?: boolean;
}
