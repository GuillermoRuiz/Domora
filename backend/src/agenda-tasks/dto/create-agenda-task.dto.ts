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
  ValidateNested,
} from 'class-validator';
import {
  AgendaLinkType,
  AgendaRecurrenceFreq,
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
} from '../../prisma/client';
import {
  MAX_CHECKLIST_ITEMS,
  MAX_REMINDER_MINUTES,
} from '../agenda-task.constants';

export class RecurrenceDto {
  @IsIn(Object.values(AgendaRecurrenceFreq))
  freq!: AgendaRecurrenceFreq;

  @IsInt()
  @Min(1)
  @Max(365)
  interval!: number;

  /** Último día en que puede empezar una ocurrencia; omitido = sin fin. */
  @IsOptional()
  @IsDateString()
  until?: string | null;
}

export class TaskLinkDto {
  @IsIn(Object.values(AgendaLinkType))
  type!: AgendaLinkType;

  @IsUUID()
  id!: string;
}

export class CreateAgendaTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsUUID()
  estateId?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsIn(Object.values(AgendaTaskType))
  type?: AgendaTaskType;

  @IsOptional()
  @IsIn(Object.values(AgendaTaskPriority))
  priority?: AgendaTaskPriority;

  @IsOptional()
  @IsIn(Object.values(AgendaTaskStatus))
  status?: AgendaTaskStatus;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  /** Fecha límite propia, distinta de cuándo se hace (no con repetición). */
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  /** Sin duración: solo cuenta el día de inicio; se pinta como nota del día. */
  @IsOptional()
  @IsBoolean()
  noDuration?: boolean;

  /** Zona IANA del navegador de quien crea la tarea (hora local de la serie). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** Minutos de antelación; 0 = en el momento; omitido = sin recordatorio. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REMINDER_MINUTES)
  reminderMinutesBefore?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  labelIds?: string[];

  /** Textos de la checklist inicial. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHECKLIST_ITEMS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  checklist?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaskLinkDto)
  links?: TaskLinkDto[];
}
