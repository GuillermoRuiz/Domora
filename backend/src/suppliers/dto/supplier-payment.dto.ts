import {
  ArrayMaxSize,
  IsArray,
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

export const SUPPLIER_PAY_METHODS = [
  PayMethod.Transferencia,
  PayMethod.Domiciliacion,
  PayMethod.Efectivo,
] as const;

export class CreateSupplierPaymentDto {
  @IsUUID()
  supplierId!: string;

  @IsISO8601({ strict: true }, { message: 'La fecha del pago no es válida.' })
  date!: string;

  /** Importe en euros. */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El importe admite como mucho dos decimales.' },
  )
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsEnum(SUPPLIER_PAY_METHODS, { message: 'Método de pago no válido.' })
  method!: PayMethod;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  /** Facturas que salda, en ese orden. Sin ellas: primero lo que vence antes. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  invoiceIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class UndoSupplierPaymentDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}
