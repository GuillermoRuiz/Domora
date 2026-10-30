import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PayMethod } from '../../prisma/client';

/** Métodos con los que se registra un cobro a mano (los demás son internos). */
export const MANUAL_PAY_METHODS = [
  PayMethod.Transferencia,
  PayMethod.Efectivo,
  PayMethod.PagoEnOficina,
  PayMethod.Bizum,
  PayMethod.Domiciliacion,
] as const;

export class CreateCollectionDto {
  @IsUUID()
  propertyId!: string;

  @IsISO8601({ strict: true }, { message: 'La fecha del cobro no es válida.' })
  date!: string;

  /** Importe en euros. */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El importe admite como mucho dos decimales.' },
  )
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsEnum(MANUAL_PAY_METHODS, { message: 'Método de cobro no válido.' })
  method!: PayMethod;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  /** Recibos a los que imputar, en ese orden. Sin ellos: orden legal. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  receiptIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class UndoCollectionDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}

export class ReturnCollectionDto {
  @IsISO8601(
    { strict: true },
    { message: 'La fecha de la devolución no es válida.' },
  )
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  returnCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  returnReason?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  feeAmount?: number;

  @IsOptional()
  @IsBoolean()
  rechargeFee?: boolean;
}

export class ApplyAdvanceDto {
  @IsUUID()
  propertyId!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  receiptIds?: string[];
}

export class CreateSuspenseDto {
  @IsISO8601(
    { strict: true },
    { message: 'La fecha del ingreso no es válida.' },
  )
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  concept!: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class ApplySuspenseDto {
  @IsUUID()
  propertyId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  receiptIds?: string[];
}

export class ListCollectionsQuery {
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
