import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { IssueStatus, IssueType } from '../../prisma/client';

export const ISSUE_STATUSES: IssueStatus[] = [
  'Abierta',
  'EnReparacion',
  'PendienteProveedor',
  'PendienteInformacion',
  'Resuelta',
  'Cerrada',
  'Retirada',
];
const ISSUE_TYPES: IssueType[] = [
  'Averia',
  'Ruido',
  'DanoEstructural',
  'Fuga',
  'Seguridad',
  'Limpieza',
  'Otro',
];

/** `GET /me/issues` filters. `status` accepts a comma-separated list. */
export class ListOwnerIssuesQuery {
  /** Una comunidad concreta; sin ella, todas aquellas de las que el usuario es miembro activo («Todas»). */
  @IsOptional() @IsUUID() estateId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @IsIn(ISSUE_STATUSES, { each: true })
  status?: IssueStatus[];
}

/** «Nueva incidencia» from the owner. */
export class CreateOwnerIssueDto {
  /** La comunidad en la que se avisa. La incidencia es de la comunidad: no se indica ninguna vivienda. */
  @IsUUID() estateId!: string;
  /** Type of fault. */
  @IsOptional() @IsIn(ISSUE_TYPES) type?: IssueType;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(5000) description!: string;
  /** Zona o instalación afectada (de `GET /me/issues/locations`, o texto libre). La gestión es quien vincula la instalación del inventario. */
  @IsString() @MinLength(1) @MaxLength(120) location!: string;
  /** Answer to «¿Hay riesgo o daños activos?»: true raises the priority to Urgente. */
  @IsBoolean() urgent!: boolean;
}

export class OwnerIssueReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000) text!: string;
}

export class RateIssueDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

/** Manager asking the owner for information. */
export class RequestIssueInfoDto {
  @IsString() @MinLength(1) @MaxLength(5000) text!: string;
}
