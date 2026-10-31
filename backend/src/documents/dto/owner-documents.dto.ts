import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const OWNER_DOCUMENT_CATEGORIES = [
  'actas',
  'economicos',
  'normativa',
  'seguros',
  'contratos',
  'otros',
] as const;
export type OwnerDocumentCategory = (typeof OWNER_DOCUMENT_CATEGORIES)[number];

export const OWNER_DOCUMENT_FILE_TYPES = [
  'pdf',
  'image',
  'spreadsheet',
  'document',
  'other',
] as const;
export type OwnerDocumentFileType = (typeof OWNER_DOCUMENT_FILE_TYPES)[number];

export const OWNER_DOCUMENT_SORTS = [
  'date_desc',
  'date_asc',
  'name_asc',
  'size_desc',
] as const;
export type OwnerDocumentSort = (typeof OWNER_DOCUMENT_SORTS)[number];

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Query strings carry booleans as text: only `true`/`false` are accepted. */
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** `GET /me/documents` filters. */
export class OwnerDocumentsQueryDto {
  /** One of the owner's properties: its estate's documents plus the ones addressed to it. */
  @IsOptional() @IsUUID() propertyId?: string;
  /** Title, description and category name. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @IsIn(OWNER_DOCUMENT_CATEGORIES)
  category?: OwnerDocumentCategory;
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Fecha no válida (AAAA-MM-DD).' })
  from?: string;
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Fecha no válida (AAAA-MM-DD).' })
  to?: string;
  @IsOptional()
  @IsIn(OWNER_DOCUMENT_FILE_TYPES)
  fileType?: OwnerDocumentFileType;
  @IsOptional() @Transform(toBoolean) @IsBoolean() onlyNew?: boolean;
  @IsOptional() @IsIn(OWNER_DOCUMENT_SORTS) sort?: OwnerDocumentSort;
}

/** `POST /me/documents/read`: ids the owner cannot see are ignored. */
export class MarkOwnerDocumentsReadDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  documentIds!: string[];
}
