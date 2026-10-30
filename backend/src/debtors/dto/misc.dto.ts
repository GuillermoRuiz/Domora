import {
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

/** Pago de una cuota de un plan: se registra como cobro. */
export class MarkInstallmentPaidDto {
  /** Fecha del cobro (AAAA-MM-DD). Por defecto, hoy. */
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsEnum(PayMethod)
  method?: PayMethod;

  /** Banco donde entró. Por defecto, el principal (o la caja si es en efectivo). */
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class CancelAgreementDto {
  @IsOptional()
  @IsString()
  cancelledReason?: string;
}

/** Devolución bancaria de una línea de remesa. */
export class RemesaLineReturnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  returnCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  returnReason?: string;

  /** Fecha del cargo de la devolución en el banco. Por defecto, hoy. */
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  /** Comisión que cobró el banco por la devolución, en euros. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  feeAmount?: number;

  /** Repercutir la comisión al propietario con un recibo de gastos. */
  @IsOptional()
  @IsBoolean()
  rechargeFee?: boolean;
}
