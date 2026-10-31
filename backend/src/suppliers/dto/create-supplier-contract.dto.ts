import {
  IsIn,
  IsNumber,
  Min,
  Max,
  ValidateIf,
  IsISO4217CurrencyCode,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SupplierContractRenewalType } from '../../prisma/client';

const RENEWAL_TYPES: SupplierContractRenewalType[] = ['manual', 'tacita'];

export class CreateSupplierContractDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  serviceType!: string;

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsIn(RENEWAL_TYPES)
  renewalType!: SupplierContractRenewalType;

  /** Sugerida por categoría en el frontend (p. ej. ascensores/extintores) — nunca validada contra una lista cerrada. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reviewFrequency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
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

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO4217CurrencyCode()
  currency?: string;

  /** Nº de contrato o de póliza (seguros). `null` lo borra al editar. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contractNumber?: string;
}
