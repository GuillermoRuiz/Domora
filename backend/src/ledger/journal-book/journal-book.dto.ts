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
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const EUROS = { maxDecimalPlaces: 2 } as const;

export class ManualLineDto {
  @IsUUID()
  accountId!: string;

  @IsNumber(EUROS)
  @Min(0)
  @Max(100_000_000)
  debit!: number;

  @IsNumber(EUROS)
  @Min(0)
  @Max(100_000_000)
  credit!: number;

  @IsOptional()
  @IsUUID()
  costCentreId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  concept?: string;
}

export class CreateManualEntryDto {
  @IsISO8601(
    { strict: true },
    { message: 'La fecha del asiento no es válida.' },
  )
  date!: string;

  @IsString()
  @MinLength(3, { message: 'Indica el concepto del asiento.' })
  @MaxLength(255)
  concept!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'Un asiento necesita al menos dos líneas.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ManualLineDto)
  lines!: ManualLineDto[];
}

export class ReverseEntryDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}

export class ListJournalQuery {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Dónde entra o sale el dinero: una cuenta bancaria o la caja. */
export class QuickEntryDto {
  @IsISO8601({ strict: true }, { message: 'La fecha no es válida.' })
  date!: string;

  @IsIn(['in', 'out'])
  direction!: 'in' | 'out';

  @IsNumber(EUROS)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  /** Cuenta bancaria; sin ella, la caja. */
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  /** Cuenta de ingreso o gasto. */
  @IsUUID()
  counterpartAccountId!: string;

  @IsOptional()
  @IsUUID()
  costCentreId?: string;

  @IsString()
  @MinLength(3, { message: 'Indica el concepto.' })
  @MaxLength(255)
  concept!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class TransferDto {
  @IsISO8601({ strict: true }, { message: 'La fecha no es válida.' })
  date!: string;

  @IsNumber(EUROS)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  /** Cuenta de origen; sin ella, la caja. */
  @IsOptional()
  @IsUUID()
  fromBankAccountId?: string;

  /** Cuenta de destino; sin ella, la caja. */
  @IsOptional()
  @IsUUID()
  toBankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  concept?: string;
}
