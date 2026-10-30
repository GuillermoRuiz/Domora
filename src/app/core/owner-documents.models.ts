/** «Documentación» of the owner (role C): shapes of `GET /me/documents`. Spec: odd/tasks/owner-documents.md (S1-S4). */

export type OwnerDocumentCategory = 'actas' | 'economicos' | 'normativa' | 'seguros' | 'contratos' | 'otros';
export type OwnerDocumentFileType = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'other';
export type OwnerDocumentSort = 'date_desc' | 'date_asc' | 'name_asc' | 'size_desc';
export type OwnerDocumentPublisher = 'Administración de la comunidad' | 'Generado por Domora';

export interface OwnerDocument {
  id: string;
  title: string;
  description: string | null;
  category: OwnerDocumentCategory;
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Readable size («2,4 MB»). */
  size: string;
  sizeBytes: number | null;
  mimeType: string | null;
  fileType: OwnerDocumentFileType;
  previewable: boolean;
  isNew: boolean;
  /** Published for the board only («Junta»). */
  board: boolean;
  publishedBy: OwnerDocumentPublisher;
  estateId: string;
  estateName: string;
}

export type OwnerDocumentCounts = Record<'all' | OwnerDocumentCategory, number>;

export interface OwnerDocumentList {
  items: OwnerDocument[];
  /** Per category inside the visible set; they ignore the category filter. */
  counts: OwnerDocumentCounts;
}

export interface OwnerDocumentQuery {
  propertyId?: string;
  q?: string;
  category?: OwnerDocumentCategory;
  from?: string;
  to?: string;
  fileType?: OwnerDocumentFileType;
  onlyNew?: boolean;
  sort?: OwnerDocumentSort;
}

export type DocumentFilePurpose = 'view' | 'download';

export type CategoryTone = 'blue' | 'accent' | 'purple' | 'success' | 'orange' | 'neutral';

export const OWNER_DOCUMENT_CATEGORIES: { value: OwnerDocumentCategory; label: string; tone: CategoryTone }[] = [
  { value: 'actas', label: 'Actas', tone: 'blue' },
  { value: 'economicos', label: 'Económicos', tone: 'accent' },
  { value: 'normativa', label: 'Normativa', tone: 'purple' },
  { value: 'seguros', label: 'Seguros', tone: 'success' },
  { value: 'contratos', label: 'Contratos', tone: 'orange' },
  { value: 'otros', label: 'Otros', tone: 'neutral' },
];

export const OWNER_DOCUMENT_FILE_TYPES: { value: OwnerDocumentFileType; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Imagen' },
  { value: 'spreadsheet', label: 'Hoja de cálculo' },
  { value: 'document', label: 'Documento' },
  { value: 'other', label: 'Otro' },
];

export function categoryInfo(category: OwnerDocumentCategory) {
  return OWNER_DOCUMENT_CATEGORIES.find((c) => c.value === category) ?? OWNER_DOCUMENT_CATEGORIES[OWNER_DOCUMENT_CATEGORIES.length - 1];
}

/** Type label of the detail («PDF · 2,4 MB»). */
export function fileTypeLabel(fileType: OwnerDocumentFileType): string {
  return fileType === 'other' ? 'Archivo' : OWNER_DOCUMENT_FILE_TYPES.find((t) => t.value === fileType)?.label ?? 'Archivo';
}
