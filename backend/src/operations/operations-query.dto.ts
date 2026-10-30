import type { IssueStatus } from '../prisma/client';
import { Type } from 'class-transformer';
import {
  BALL_PARTIES,
  ISSUE_SITUATIONS,
  ISSUE_SITUATION_FILTER_KEYS,
  type BallParty,
  type IssueSituation,
  type IssueSituationFilter,
} from '../issue-workflow/issue-situation';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class OperationsQueryDto {
  @IsOptional() @IsUUID() estateId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
export class MeetingsQueryDto extends OperationsQueryDto {
  @IsOptional() @IsIn(['newest', 'oldest']) sort?: 'newest' | 'oldest';
  @IsOptional()
  @IsIn(['all', 'convocada', 'celebrada', 'firmada', 'cancelada', 'acta'])
  filter?: 'all' | 'convocada' | 'celebrada' | 'firmada' | 'cancelada' | 'acta';
}
/** Orden del listado de Incidencias: por fecha (`newest`/`oldest`) o por una columna, ascendente o descendente. */
export const ISSUE_SORT_FIELDS = [
  'ref',
  'title',
  'estate',
  'status',
  'situation',
  'ball',
] as const;
export const ISSUE_SORTS = [
  'newest',
  'oldest',
  ...ISSUE_SORT_FIELDS.flatMap(
    (field) => [`${field}_asc`, `${field}_desc`] as const,
  ),
] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export class IssuesQueryDto extends OperationsQueryDto {
  @IsOptional() @IsIn([...ISSUE_SORTS]) sort?: IssueSort;
  /** Grupo de situaciones de las tarjetas de la lista (la misma agrupación que el resumen). */
  @IsOptional()
  @IsIn(['all', ...ISSUE_SITUATION_FILTER_KEYS])
  filter?: 'all' | IssueSituationFilter;
  @IsOptional() @IsIn([...ISSUE_SITUATIONS]) situation?: IssueSituation;
  @IsOptional() @IsIn([...BALL_PARTIES]) ball?: BallParty;
  @IsOptional()
  @IsIn([
    'Abierta',
    'EnReparacion',
    'PendienteProveedor',
    'PendienteInformacion',
    'Resuelta',
    'Cerrada',
    'Retirada',
  ])
  status?: IssueStatus;
  /** Antigüedad máxima de la incidencia. */
  @IsOptional() @IsIn(['7d', '30d', '90d', 'year']) created?:
    '7d' | '30d' | '90d' | 'year';
  /** Solo las incidencias de esta instalación (enlace desde el panel de Instalaciones). */
  @IsOptional() @IsUUID() assetId?: string;
}
