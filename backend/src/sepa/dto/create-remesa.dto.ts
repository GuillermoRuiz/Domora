import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SepaScheme } from '../../prisma/client';

const SCHEMES: SepaScheme[] = ['CORE', 'B2B'];

export class CreateRemesaDto {
  /** Periodo contable origen de los recibos ('YYYY-MM'). */
  @Matches(/^\d{4}-\d{2}$/)
  periodKey!: string;

  /** Fecha de cobro solicitada (D-1 mínimo para CORE). */
  @IsDateString()
  chargeDate!: string;

  @IsIn(SCHEMES)
  scheme!: SepaScheme;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  concept!: string;

  /** Identificador de mensaje opcional; por defecto se genera. */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  messageId?: string;

  /** Recibos elegibles que el usuario deselecciona explícitamente en el wizard. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excludeReceiptIds?: string[];
}
