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

export const WITHHOLDING_KEYS = [
  'G_profesional',
  'A_trabajo',
  'other',
] as const;

export class SupplierInvoiceLineDto {
  /** Cuenta de gasto (grupo 6) del plan de la finca. */
  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsUUID()
  costCentreId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /** Base imponible de la línea, en euros. */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'La base admite como mucho dos decimales.' },
  )
  @Min(0.01)
  @Max(10_000_000)
  baseAmount!: number;
}

export class CreateSupplierInvoiceDto {
  /** Número que pone el proveedor en la factura. */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  number!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  concept!: string;

  @IsISO8601(
    { strict: true },
    { message: 'La fecha de la factura no es válida.' },
  )
  issueDate!: string;

  /** Fecha en que se recibe: la contable. Sin ella, la de la factura. */
  @IsOptional()
  @IsISO8601({ strict: true })
  receivedDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  vatRatePct!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  withholdingRatePct!: number;

  @IsOptional()
  @IsIn(WITHHOLDING_KEYS)
  withholdingKey?: (typeof WITHHOLDING_KEYS)[number];

  /** 400 Proveedores (por defecto) o 410 Acreedores por servicios. */
  @IsOptional()
  @IsIn(['400', '410'])
  payableAccount?: '400' | '410';

  @IsArray()
  @ArrayMinSize(1, {
    message: 'La factura necesita al menos una línea de gasto.',
  })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineDto)
  lines!: SupplierInvoiceLineDto[];
}
