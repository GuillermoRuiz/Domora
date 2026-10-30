import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgendaTaskStatus } from '../../prisma/client';
import { MAX_LIST_LIMIT } from '../agenda-task.constants';

export class UpdateTaskStatusDto {
  @IsIn(Object.values(AgendaTaskStatus))
  status!: AgendaTaskStatus;

  /**
   * Solo para series: inicio de la ocurrencia que se resuelve. Sin él, el
   * cambio se aplica a la tarea entera.
   */
  @IsOptional()
  @IsDateString()
  occurrenceStart?: string;

  /**
   * Solo con `status: 'PENDIENTE'`: si la tarea está completada, vuelve al
   * estado que tenía antes de completarse (PENDIENTE si no se conoce).
   */
  @IsOptional()
  @IsBoolean()
  restorePrevious?: boolean;
}

/**
 * Resolución de una tarea de decisión. `result` se valida después, contra el
 * esquema del tipo de la tarea (no se puede describir aquí: cambia por tipo).
 */
export class ResolveAgendaTaskDto {
  @IsObject()
  result!: Record<string, unknown>;
}

export class AddCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;
}

export class AddChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  text!: string;
}

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  text?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class CreateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

/**
 * Parámetros de consulta. Las listas (`status`, `priority`…) viajan separadas
 * por comas. Con `from` y `to` es una consulta de calendario; sin ellos solo
 * devuelve trabajo ABIERTO (lista de vencidas/urgentes), nunca el histórico.
 */
export class ListAgendaTasksQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  estateId?: string;

  /** "me", "none" (sin asignar) o el id de un usuario. */
  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignee?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  labelIds?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: string;

  /**
   * Zona IANA del cliente. Las tareas de día completo son fechas de calendario,
   * así que para saber qué días abarca [from, to) hay que mirarlo en su zona.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tz?: string;

  /** Tope de filas de la lista sin rango (vencidas, urgentes…). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit?: number;
}

export class AgendaSummaryQueryDto {
  @IsDateString()
  dayFrom!: string;

  @IsDateString()
  dayTo!: string;

  @IsDateString()
  weekFrom!: string;

  @IsDateString()
  weekTo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  estateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignee?: string;

  /**
   * Zona IANA del cliente. Las tareas de día completo son fechas de calendario,
   * así que para saber qué días abarca [from, to) hay que mirarlo en su zona.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tz?: string;
}
