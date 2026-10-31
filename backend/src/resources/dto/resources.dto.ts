import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AlertSourceType,
  CommunicationCategory,
  MeetingSignerRole,
} from '../../prisma/client';

const COMMUNICATION_CATEGORIES: CommunicationCategory[] = [
  'General',
  'Urgente',
  'Mercadillo',
  'ObjetosPerdidos',
  'Evento',
];

const LEGAL_NOTICE_SIGNER_ROLES: MeetingSignerRole[] = [
  'administrador',
  'presidente',
  'secretario',
];

const SOURCE_TYPES: AlertSourceType[] = [
  'issue',
  'receipt',
  'communication',
  'document',
  'event',
  'meeting',
  'supplier_contract',
  'budget_item',
];

export class MarkResourceReadDto {
  @IsIn(SOURCE_TYPES)
  sourceType!: AlertSourceType;

  @IsUUID()
  sourceId!: string;
}

// `from`/`estateId` NO forman parte del DTO a propósito: el nombre a
// mostrar se deriva siempre del usuario autenticado (nunca del cliente,
// para no poder falsificar el autor) y la finca ya la fija el parámetro de
// ruta.
export class CreateCommunicationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  /** Fecha de vigencia opcional: pasado ese momento, se considera archivado (calculado, no persistido). */
  @IsOptional()
  @IsDateString()
  activeUntil?: string;

  /** Rol C nunca puede mandar 'Urgente' — rechazado server-side (assertPrivilegedFields). */
  @IsOptional()
  @IsIn(COMMUNICATION_CATEGORIES)
  category?: CommunicationCategory;

  /** Solo A/B — rol C nunca puede dirigir un comunicado a una propiedad. */
  @IsOptional()
  @IsUUID()
  targetPropertyId?: string;

  /** Solo A/B — LPH art. 9.1.h. */
  @IsOptional()
  @IsBoolean()
  isLegalNotice?: boolean;

  @IsOptional()
  @IsIn(LEGAL_NOTICE_SIGNER_ROLES)
  legalNoticeSignerRole?: MeetingSignerRole;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalNoticeSignerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  legalNoticeReason?: string;

  @IsOptional()
  @IsBoolean()
  legalNoticeCountersignedByPresident?: boolean;
}

export class UpdateCommunicationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  /** `null` explícito = quitar la fecha de vigencia. */
  @IsOptional()
  @IsDateString()
  activeUntil?: string | null;

  @IsOptional()
  @IsIn(COMMUNICATION_CATEGORIES)
  category?: CommunicationCategory;

  /** `null` explícito = quitar el destino (vuelve a ser de toda la finca). */
  @IsOptional()
  @IsUUID()
  targetPropertyId?: string | null;

  @IsOptional()
  @IsBoolean()
  isLegalNotice?: boolean;

  @IsOptional()
  @IsIn(LEGAL_NOTICE_SIGNER_ROLES)
  legalNoticeSignerRole?: MeetingSignerRole;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalNoticeSignerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  legalNoticeReason?: string;

  @IsOptional()
  @IsBoolean()
  legalNoticeCountersignedByPresident?: boolean;
}

export class SetCommunicationArchivedDto {
  @IsBoolean()
  archived!: boolean;
}

export class SetCommunicationPinnedDto {
  @IsBoolean()
  pinned!: boolean;
}

export class AddCommunicationReplyDto {
  @IsString()
  @MinLength(1)
  text!: string;
}

export class UploadCommunicationAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

export class CreateDocumentDto {
  @IsOptional()
  @IsUUID()
  estateId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type!: string;

  @IsDateString()
  date!: string;

  @IsString()
  @MaxLength(20)
  size!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  s3Key?: string;
}
