import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';
import type { RegulatoryInspectionStatus } from '../../prisma/client';

const STATUSES: RegulatoryInspectionStatus[] = [
  'planificada',
  'citada',
  'realizada',
  'desfavorable',
  'vencida',
  'exenta',
];

/**
 * Parcial: cada acción de la pestaña (reprogramar, confirmar cita, cerrar
 * el ciclo) solo toca un subconjunto — `InspectionsService.update` aplica
 * un merge, no un reemplazo completo.
 */
export class UpdateInspectionDto {
  @OptionalButNotNull()
  @IsIn(STATUSES)
  status?: RegulatoryInspectionStatus;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string | null;

  /** Al fijarse junto con `status: 'citada'`, dispara el aviso a inquilinos/propietarios. */
  @IsOptional()
  @IsDateString()
  appointmentDate?: string | null;

  @IsOptional()
  @IsDateString()
  lastDoneDate?: string | null;

  @OptionalButNotNull()
  @IsInt()
  @Min(1)
  @Max(365)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
