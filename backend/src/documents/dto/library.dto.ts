import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { DocumentVisibility } from '../../prisma/client';

export const FOLDER_VISIBILITIES = ['MANAGER', 'BOARD', 'OWNERS'] as const;
export const DOCUMENT_VISIBILITIES = ['MANAGER', 'BOARD', 'OWNERS', 'PROPERTY'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LibraryQueryDto {
  /** Folder to list; `root` = documents without folder. Ignored when `q` searches the whole library. */
  @IsOptional() @IsString() @Matches(/^(root|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, { message: 'Carpeta no válida.' }) folderId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['trash', 'review']) view?: 'trash' | 'review';
}

export class CreateFolderDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() parentId?: string;
  /** Omitted or null = inherits from the parent (MANAGER at the root). */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn(FOLDER_VISIBILITIES) visibility?: DocumentVisibility | null;
}

export class UpdateFolderDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  /** null moves the folder to the library root. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() parentId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn(FOLDER_VISIBILITIES) visibility?: DocumentVisibility | null;
}

export class UploadDocumentDto {
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  @IsOptional() @IsString() @MaxLength(100) type?: string;
  @IsOptional() @IsUUID() folderId?: string;
  @IsOptional() @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibility;
  /** Recipient property; implies visibility PROPERTY. */
  @IsOptional() @IsUUID() targetPropertyId?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdateDocumentDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsString() @MaxLength(100) type?: string;
  /** null moves the document to the library root. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() folderId?: string | null;
  /** null = inherit from the folder again. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibility | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() targetPropertyId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
}

export class ReviewDocumentsDto {
  /** Keep these documents «Solo gestora» and stop flagging them for review. */
  @IsUUID('all', { each: true }) documentIds!: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}
