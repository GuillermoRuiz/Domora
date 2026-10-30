import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';

/** Quién ve un documento (D1 de odd/tasks/documentos-finca.md). */
export type DocumentVisibility = 'MANAGER' | 'BOARD' | 'OWNERS' | 'PROPERTY';
export type FolderVisibility = Exclude<DocumentVisibility, 'PROPERTY'>;

export const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  MANAGER: 'Solo gestora',
  BOARD: 'Junta de gobierno',
  OWNERS: 'Todos los propietarios',
  PROPERTY: 'Una propiedad',
};

export const VISIBILITY_HINT: Record<DocumentVisibility, string> = {
  MANAGER: 'Solo lo ve la gestora.',
  BOARD: 'Lo ven la gestora, el presidente y los vicepresidentes vigentes.',
  OWNERS: 'Lo ven la gestora y todos los propietarios de la finca (no los inquilinos).',
  PROPERTY: 'Lo ven la gestora y los propietarios de una vivienda concreta.',
};

export interface LibraryFolder {
  id: string;
  parentId: string | null;
  name: string;
  systemKey: string | null;
  /** Solo para la gestora: null = hereda de la carpeta padre. */
  visibility?: FolderVisibility | null;
  effectiveVisibility?: FolderVisibility;
  /** Documentos de la carpeta y sus subcarpetas que puede ver quien consulta. */
  documentCount: number;
  /** Solo para la gestora: cuántos de ellos ve un propietario («Ver como propietario»). */
  ownerDocumentCount?: number;
}

export interface LibraryDocument {
  id: string;
  title: string;
  type: string;
  date: string;
  size: string;
  sizeBytes: number | null;
  mimeType: string | null;
  folderId: string | null;
  source: 'upload' | 'generated';
  description: string | null;
  targetPropertyId: string | null;
  createdAt: string;
  updatedAt: string;
  // Gestora:
  visibility?: DocumentVisibility | null;
  effectiveVisibility?: DocumentVisibility;
  visibilityReviewPending?: boolean;
  deletedAt?: string | null;
  // Propietario:
  isNew?: boolean;
}

export interface LibraryListing {
  folders: LibraryFolder[];
  rootDocumentCount: number;
  rootOwnerDocumentCount?: number;
  documents: LibraryDocument[];
  pendingReview?: number;
  inTrash?: number;
}

export interface LibraryQuery { folderId?: string | null; q?: string; view?: 'trash' | 'review' }

export interface UploadOptions {
  folderId?: string | null;
  type?: string;
  title?: string;
  visibility?: DocumentVisibility | null;
  targetPropertyId?: string | null;
  description?: string;
}

export interface DocumentPatch {
  title?: string;
  type?: string;
  folderId?: string | null;
  visibility?: DocumentVisibility | null;
  targetPropertyId?: string | null;
  description?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DocumentLibraryService {
  private readonly api = inject(ApiClientService);
  private base = (estateId: string) => `/estates/${estateId}/library`;

  list(estateId: string, query: LibraryQuery = {}): Promise<LibraryListing> {
    const params = new URLSearchParams();
    if (query.q?.trim()) params.set('q', query.q.trim());
    else if (query.view) params.set('view', query.view);
    else params.set('folderId', query.folderId ?? 'root');
    return this.api.get<LibraryListing>(`${this.base(estateId)}?${params.toString()}`);
  }

  upload(estateId: string, file: File, options: UploadOptions = {}): Promise<LibraryDocument> {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
    }
    return this.api.post<LibraryDocument>(`/estates/${estateId}/documents/upload`, form);
  }

  createFolder(estateId: string, body: { name: string; parentId?: string | null; visibility?: FolderVisibility | null }) {
    return this.api.post<LibraryFolder>(`${this.base(estateId)}/folders`, { ...body, parentId: body.parentId ?? undefined });
  }

  updateFolder(estateId: string, folderId: string, body: { name?: string; parentId?: string | null; visibility?: FolderVisibility | null }) {
    return this.api.patch<{ id: string; opened: string[] }>(`${this.base(estateId)}/folders/${folderId}`, body);
  }

  deleteFolder(estateId: string, folderId: string) {
    return this.api.delete<unknown>(`${this.base(estateId)}/folders/${folderId}`);
  }

  updateDocument(estateId: string, documentId: string, patch: DocumentPatch) {
    return this.api.patch<LibraryDocument>(`${this.base(estateId)}/documents/${documentId}`, patch);
  }

  trash(estateId: string, documentId: string) {
    return this.api.delete<unknown>(`${this.base(estateId)}/documents/${documentId}`);
  }

  restore(estateId: string, documentId: string) {
    return this.api.post<unknown>(`${this.base(estateId)}/documents/${documentId}/restore`, {});
  }

  /** «Mantener solo para la gestora» de documentos que la migración dejó pendientes de revisar. */
  markReviewed(estateId: string, documentIds: string[], all = false) {
    return this.api.post<{ reviewed: number }>(`${this.base(estateId)}/review`, { documentIds, all });
  }

  /** Contenido del fichero (la descarga queda auditada en el servidor). */
  /** `purpose` tells the server how to audit the access: a preview is a `view`, a save a `download`. */
  file(documentId: string, purpose?: 'view' | 'download'): Promise<Blob> {
    const query = purpose ? `?purpose=${purpose}` : '';
    return this.api.getBlob(`/documents/${documentId}/file${query}`);
  }
}

/**
 * Server message of a failed file download: the error body of a blob request is itself a Blob,
 * so the usual `error.message` is not there until it is read.
 */
export async function downloadErrorMessage(err: unknown, fallback: string): Promise<string> {
  const body = (err as { error?: unknown })?.error;
  try {
    const parsed = body instanceof Blob ? JSON.parse(await body.text()) : body;
    const message = (parsed as { message?: unknown })?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Not JSON: keep the fallback.
  }
  return fallback;
}
