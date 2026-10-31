import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IssueType, Priority } from '../../prisma/client';
import { ISSUE_REPORT_CHANNELS } from '../issue-report.constants';
import {
  RESOLUTION_ROUTES,
  type ResolutionRoute,
} from '../../issue-workflow/resolution-routes';

const ISSUE_TYPES: IssueType[] = [
  'Averia',
  'Ruido',
  'DanoEstructural',
  'Fuga',
  'Seguridad',
  'Limpieza',
  'Otro',
];
const PRIORITIES: Priority[] = ['Normal', 'Urgente'];

export class CreateIssueDto {
  @IsIn(ISSUE_TYPES)
  type!: IssueType;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsIn(PRIORITIES)
  priority!: Priority;

  /**
   * Instalación (elemento común) a la que se refiere. OPCIONAL: una incidencia
   * puede ser de un elemento que no está dado de alta (un tejado con goteras).
   * Solo la gestión puede indicarla.
   */
  @IsOptional()
  @IsUUID()
  assetId?: string;

  /**
   * Por dónde llegó el aviso. Solo la gestión puede indicarlo (registra una
   * llamada, reenvía un email); un propietario siempre avisa por el formulario.
   */
  @IsOptional()
  @IsIn(ISSUE_REPORT_CHANNELS)
  channel?: (typeof ISSUE_REPORT_CHANNELS)[number];

  /**
   * Vía de gestión decidida al crear la incidencia (solo la gestión). Se aplica en la misma petición: la incidencia nace con su vía
   * y no se abre «Revisar incidencia nueva», porque ya no hay nada que decidir; solo el paso concreto de esa vía.
   */
  @IsOptional()
  @IsIn(RESOLUTION_ROUTES)
  resolutionRoute?: ResolutionRoute;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  routeReason?: string;

  /** Identificador del aviso original (Message-ID, id de llamada…): impide registrarlo dos veces. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceRef?: string;

  /**
   * La persona con cuenta (miembro de la comunidad) que avisó: queda como reportante de la incidencia, igual que si la
   * hubiera creado ella, y recibe los avisos del solicitante. Solo la gestión la indica, al registrar un aviso por otra vía.
   */
  @IsOptional()
  @IsUUID()
  reporterUserId?: string;

  /** Quien avisa, si no es un usuario de Domora (una llamada de alguien sin cuenta). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterContact?: string;

  /** Zona o instalación afectada (texto libre; nunca una vivienda). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;
}
