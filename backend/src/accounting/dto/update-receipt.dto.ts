import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PayMethod, ReceiptStatus } from '../../prisma/client';

const STATUSES: ReceiptStatus[] = ['Pagada', 'Pendiente', 'Devuelto'];
const METHODS: PayMethod[] = [
  'Domiciliacion',
  'Transferencia',
  'Efectivo',
  'PagoEnOficina',
  'Bizum',
  'Devolucion',
  'Pendiente',
];

/**
 * Registro manual de cobro/devolución (PATCH /receipts/:id). Parcial y
 * Anulado no se ponen a mano: salen de los cobros y de la anulación.
 */
export class UpdateReceiptDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ReceiptStatus;

  @IsOptional()
  @IsIn(METHODS)
  method?: PayMethod;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  returnCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  returnReason?: string;
}

export class CancelReceiptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason!: string;
}
