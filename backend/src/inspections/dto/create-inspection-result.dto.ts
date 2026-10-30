import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import type { InspectionOutcome } from '../../prisma/client';

const OUTCOMES: InspectionOutcome[] = ['favorable', 'desfavorable'];

/** Campos no-fichero del multipart `POST inspections/:id/results` (el certificado va en el campo `file`). */
export class CreateInspectionResultDto {
  @IsDateString()
  date!: string;

  @IsIn(OUTCOMES)
  outcome!: InspectionOutcome;

  @IsOptional()
  @IsString()
  defects?: string;

  // Multipart entrega todo como string (no hay JSON body) — se valida como
  // numérico aquí y se convierte a Decimal en el service.
  @IsOptional()
  @IsNumberString()
  cost?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
