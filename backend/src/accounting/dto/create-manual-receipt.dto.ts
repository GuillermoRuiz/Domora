import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { PayMethod, ReceiptKind } from '../../prisma/client';

const PAY_METHODS: PayMethod[] = [
  'Domiciliacion',
  'Transferencia',
  'Efectivo',
  'PagoEnOficina',
  'Bizum',
  'Devolucion',
  'Pendiente',
];

export const MANUAL_RECEIPT_KINDS: ReceiptKind[] = [
  'cuota_ordinaria',
  'derrama',
  'fondo_reserva',
  'gastos_devolucion',
  'otros',
];

export class CreateManualReceiptDto {
  @IsUUID()
  propertyId!: string;

  /** Periodo en formato 'YYYY-MM' — se crea si todavía no existe (upsert). */
  @Matches(/^\d{4}-\d{2}$/)
  periodKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  monthAbbrev?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  concept!: string;

  /**
   * Decide la cuenta de ingreso. "Saldo anterior" e "intereses de demora"
   * no se emiten a mano: salen de los saldos iniciales y de la liquidación
   * de intereses.
   */
  @IsIn(MANUAL_RECEIPT_KINDS)
  kind!: ReceiptKind;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  dueDate!: string;

  @IsIn(PAY_METHODS)
  method!: PayMethod;

  @IsOptional()
  @IsBoolean()
  includeInRemesa?: boolean;
}
