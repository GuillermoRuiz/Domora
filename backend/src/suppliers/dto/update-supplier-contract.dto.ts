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
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

const RENEWAL_TYPES: SupplierContractRenewalType[] = ['manual', 'tacita'];

export class UpdateSupplierContractDto {
  // Servicio, inicio y renovación son obligatorios: se pueden omitir, pero no poner a `null` (400).
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  serviceType?: string;

  @OptionalButNotNull()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @OptionalButNotNull()
  @IsIn(RENEWAL_TYPES)
  renewalType?: SupplierContractRenewalType;

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

  @OptionalButNotNull()
  @IsISO4217CurrencyCode()
  currency?: string;

  /** Nº de contrato o de póliza (seguros). `null` lo borra al editar. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contractNumber?: string | null;
}

export class CancelSupplierContractDto {
  @IsOptional()
  @IsString()
  cancelledReason?: string;
}
