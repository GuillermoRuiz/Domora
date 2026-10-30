import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Una factura registrada no se edita (está contabilizada): solo cambia su
 * vencimiento. Para corregir importes, cuentas o fechas, se anula y se
 * registra otra.
 */
export class UpdateSupplierInvoiceDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  dueDate?: string | null;
}

export class CancelSupplierInvoiceDto {
  @IsString()
  @MinLength(3, { message: 'Indica el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}
