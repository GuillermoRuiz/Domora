import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AgendaTaskPriority, AgendaTaskType } from '../../prisma/client';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';
import { MAX_REMINDER_MINUTES } from '../agenda-task.constants';
import { RecurrenceDto, TaskLinkDto } from './create-agenda-task.dto';

/**
 * Edición parcial. Título, tipo, prioridad, fechas, «todo el día» y zona horaria son obligatorios: se
 * pueden omitir, pero no poner a `null` (400). En los campos anulables, `null` BORRA el valor
 * (`@ValidateIf` evita validar el tipo cuando llega `null`), mientras que
 * omitirlos lo deja como está. El estado no se cambia aquí sino por
 * `PATCH :id/status`, que además resuelve ocurrencias de series.
 */
export class UpdateAgendaTaskDto {
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  estateId?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string | null;

  @OptionalButNotNull()
  @IsIn(Object.values(AgendaTaskType))
  type?: AgendaTaskType;

  @OptionalButNotNull()
  @IsIn(Object.values(AgendaTaskPriority))
  priority?: AgendaTaskPriority;

  @OptionalButNotNull()
  @IsDateString()
  startAt?: string;

  @OptionalButNotNull()
  @IsDateString()
  endAt?: string;

  /** Fecha límite propia; `null` la quita (vence al acabar el bloque). */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @OptionalButNotNull()
  @IsBoolean()
  allDay?: boolean;

  @OptionalButNotNull()
  @IsBoolean()
  noDuration?: boolean;

  @OptionalButNotNull()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REMINDER_MINUTES)
  reminderMinutesBefore?: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  labelIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaskLinkDto)
  links?: TaskLinkDto[];
}
