import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PayMethod } from '../../prisma/client';

const EUROS = { maxDecimalPlaces: 2 } as const;

export class CreatePayrollDto {
  @IsUUID()
  staffMemberId!: string;

  /** Mes de la nómina, AAAA-MM. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El mes debe tener el formato AAAA-MM.',
  })
  period!: string;

  @IsOptional()
  @IsIn(['mensual', 'extra', 'finiquito', 'otros'])
  kind?: 'mensual' | 'extra' | 'finiquito' | 'otros';

  /** Fecha contable. Sin ella, el último día del mes. */
  @IsOptional()
  @IsISO8601({ strict: true })
  accrualDate?: string;

  @IsNumber(EUROS)
  @Min(0.01)
  @Max(1_000_000)
  grossSalary!: number;

  @IsNumber(EUROS)
  @Min(0)
  @Max(1_000_000)
  employeeSs!: number;

  @IsNumber(EUROS)
  @Min(0)
  @Max(1_000_000)
  employerSs!: number;

  @IsNumber(EUROS)
  @Min(0)
  @Max(1_000_000)
  irpfWithholding!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class PayPayrollDto {
  @IsISO8601({ strict: true }, { message: 'La fecha del pago no es válida.' })
  date!: string;

  @IsEnum([PayMethod.Transferencia, PayMethod.Efectivo], {
    message: 'Método de pago no válido.',
  })
  method!: PayMethod;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class PayrollReasonDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}
