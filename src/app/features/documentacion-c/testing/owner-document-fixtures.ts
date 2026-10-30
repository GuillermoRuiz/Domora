import type { OwnerDocument, OwnerDocumentCounts, OwnerDocumentList } from '../../../core/owner-documents.models';

/** Test data for the «Documentación» specs (shapes of `/me/documents`). */
export function ownerDocument(overrides: Partial<OwnerDocument> = {}): OwnerDocument {
  return {
    id: 'd1',
    title: 'Acta junta ordinaria 2026',
    description: 'Acta de la junta ordinaria de propietarios.',
    category: 'actas',
    date: '2026-10-12',
    size: '2,4 MB',
    sizeBytes: 2_400_000,
    mimeType: 'application/pdf',
    fileType: 'pdf',
    previewable: true,
    isNew: false,
    board: false,
    publishedBy: 'Administración de la comunidad',
    estateId: 'e1',
    estateName: 'Colón 24',
    ...overrides,
  };
}

export const COUNTS: OwnerDocumentCounts = { all: 12, actas: 3, economicos: 4, normativa: 2, seguros: 1, contratos: 1, otros: 1 };

export function documentList(items: OwnerDocument[] = [ownerDocument()], counts: OwnerDocumentCounts = COUNTS): OwnerDocumentList {
  return { items, counts };
}
