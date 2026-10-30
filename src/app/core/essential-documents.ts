/**
 * Documentos esenciales de una finca: la pestaña «Datos generales» muestra el
 * último subido de cada tipo. Mismas cadenas que `ESSENTIAL_DOCUMENT_TYPES`
 * del backend (estate-general.service.ts): el tipo del documento es texto libre.
 */
export const ESSENTIAL_DOCUMENT_TYPES = ['Escritura de constitución', 'Estatutos', 'CIF de la comunidad', 'IBI', 'Póliza de seguro'] as const;
export type EssentialDocumentType = (typeof ESSENTIAL_DOCUMENT_TYPES)[number];
