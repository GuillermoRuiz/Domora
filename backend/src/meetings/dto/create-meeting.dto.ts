import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Solo se captura como dato — no se ejecuta ninguna votación real. La
 * integración con `vote_sessions` (panel de votación en directo) es una
 * historia aparte, fuera de alcance de la videollamada de juntas.
 */
export class VoteQuestionDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(['single_choice', 'multiple_choice', 'text'])
  type!: 'single_choice' | 'multiple_choice' | 'text';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  /** Color `#RRGGBB` de cada respuesta (mismo orden que `options`); cadena vacía = el de por defecto. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { each: true })
  optionColors?: string[];

  /**
   * Mayoría con la que se aprueba esta pregunta (art. 17 LPH). Se fija al
   * preparar la junta y al abrir la votación se usa tal cual.
   */
  @IsOptional()
  @IsIn(['unanimidad', 'tresQuintos', 'mayoriaSimple'])
  majorityType?: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple';
}

export class VoteTemplateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VoteQuestionDto)
  questions!: VoteQuestionDto[];
}

export class AgendaItemDto {
  @IsOptional()
  @IsIn([
    'annual_accounts_approval',
    'annual_budget_approval',
    'community_officers_appointment',
  ])
  systemKey?:
    | 'annual_accounts_approval'
    | 'annual_budget_approval'
    | 'community_officers_appointment';

  @IsOptional()
  @IsBoolean()
  systemGenerated?: boolean;

  @IsString()
  @MinLength(1)
  id!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  hasVote?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => VoteTemplateDto)
  voteTemplate?: VoteTemplateDto;

  /** Cuándo se dio por tratado un punto sin votación (lo fija `PATCH :id/agenda/:itemId/treated`; el cliente solo lo devuelve al editar la junta). */
  @IsOptional()
  @IsDateString()
  treatedAt?: string;

  /** Comentarios del administrador sobre el punto (salen en el acta); se editan con `PATCH :id/agenda/:itemId/comments`. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;
}

/** Línea del orden del día tal y como se imprime en la convocatoria. */
export class ConvocatoriaAgendaLineDto {
  @IsString()
  @MaxLength(10)
  number!: string;

  @IsString()
  @MaxLength(2000)
  text!: string;
}

export class ConvocatoriaHeaderDto {
  @IsString()
  @MaxLength(300)
  community!: string;

  @IsString()
  @MaxLength(300)
  title!: string;
}

export class ConvocatoriaAuthorizationDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(4000)
  text!: string;
}

/** Texto de la convocatoria que la gestora revisa y edita al crear la junta (ver `convocatoria-document.ts`). */
export class ConvocatoriaDocumentDto {
  @ValidateNested()
  @Type(() => ConvocatoriaHeaderDto)
  header!: ConvocatoriaHeaderDto;

  @IsString()
  @MaxLength(2000)
  notice!: string;

  @IsString()
  @MaxLength(300)
  issuedLine!: string;

  @IsString()
  @MaxLength(300)
  greeting!: string;

  @IsString()
  @MaxLength(4000)
  intro!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ConvocatoriaAgendaLineDto)
  agenda!: ConvocatoriaAgendaLineDto[];

  @IsString()
  @MaxLength(4000)
  closing!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  signature!: string[];

  @ValidateNested()
  @Type(() => ConvocatoriaAuthorizationDto)
  authorization!: ConvocatoriaAuthorizationDto;
}

/** Datos de la junta con los que se redacta la convocatoria por defecto (antes de crearla). */
export class ConvocatoriaPreviewDto {
  @IsIn(['ordinaria', 'extraordinaria'])
  type!: 'ordinaria' | 'extraordinaria';

  @IsIn(['presidente', 'cuotas25', 'propietarios25', 'mandatoJudicial'])
  convokedBy!: 'presidente' | 'cuotas25' | 'propietarios25' | 'mandatoJudicial';

  @IsDateString()
  scheduledAt1!: string;

  @IsDateString()
  scheduledAt2!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgendaItemDto)
  agenda!: AgendaItemDto[];

  @IsIn(['administrador', 'presidente', 'secretario'])
  signerRole!: 'administrador' | 'presidente' | 'secretario';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  signerName?: string;
}

export class CreateMeetingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  title!: string;

  @IsIn(['ordinaria', 'extraordinaria'])
  type!: 'ordinaria' | 'extraordinaria';

  @IsDateString()
  scheduledAt1!: string;

  @IsDateString()
  scheduledAt2!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AgendaItemDto)
  agenda!: AgendaItemDto[];

  @IsIn(['presidente', 'cuotas25', 'propietarios25', 'mandatoJudicial'])
  convokedBy!: 'presidente' | 'cuotas25' | 'propietarios25' | 'mandatoJudicial';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsString()
  locationPlaceId?: string;

  @IsOptional()
  @IsNumber()
  locationLat?: number;

  @IsOptional()
  @IsNumber()
  locationLng?: number;

  @IsIn(['administrador', 'presidente', 'secretario'])
  signerRole!: 'administrador' | 'presidente' | 'secretario';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  signerName?: string;

  /** Snapshot de emails al crear — no son necesariamente usuarios de la plataforma. */
  @IsArray()
  @IsString({ each: true })
  attendeeEmails!: string[];

  @IsBoolean()
  includeJitsi!: boolean;

  /**
   * Constancia explícita de la gestora de que la finca tiene respaldo
   * estatutario (art. 17.6 LPH) para asistencia telemática, o de que
   * asume el riesgo de impugnación — solo tiene efecto si `includeJitsi`
   * es `true`. Sin motor legal: nunca bloquea la creación, solo se
   * registra (o no) para mostrar el aviso correspondiente.
   */
  @IsOptional()
  @IsBoolean()
  telematicBackingConfirmed?: boolean;

  /** Convocatoria revisada y editada por la gestora; sin ella se redacta la habitual al pedirla. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ConvocatoriaDocumentDto)
  convocatoria?: ConvocatoriaDocumentDto;
}
