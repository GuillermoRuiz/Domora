import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaxIdCountry } from '../../prisma/client';

/**
 * Titular sin cuenta en la plataforma, dado de alta a mano por la gestora
 * (hasta ahora solo lo creaba el importador, así que una finca creada desde
 * cero no podía registrar ni un propietario). Siempre `Propietario`: es el
 * titular de la unidad, no un inquilino — el rol no viaja en el DTO.
 */
export class CreateExternalOwnerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEnum(TaxIdCountry)
  taxIdCountry?: TaxIdCountry;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  postalAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Mismos campos, todos opcionales; `null` borra los opcionales. */
export class UpdateExternalOwnerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEnum(TaxIdCountry)
  taxIdCountry?: TaxIdCountry | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  postalAddress?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
