import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { DocumentFilePurpose, OwnerDocumentList, OwnerDocumentQuery } from './owner-documents.models';

/** «Documentación» of the signed-in owner (`/me/documents`) and its files. */
@Injectable({ providedIn: 'root' })
export class OwnerDocumentsService {
  private api = inject(ApiClientService);

  list(query: OwnerDocumentQuery = {}): Promise<OwnerDocumentList> {
    return this.api.get<OwnerDocumentList>('/me/documents', {
      propertyId: query.propertyId,
      q: query.q?.trim() || undefined,
      category: query.category,
      from: query.from || undefined,
      to: query.to || undefined,
      fileType: query.fileType,
      onlyNew: query.onlyNew ? true : undefined,
      sort: query.sort,
    });
  }

  markRead(documentIds: string[]): Promise<{ marked: number }> {
    return this.api.post<{ marked: number }>('/me/documents/read', { documentIds });
  }

  /** The file itself, through the authenticated client (never a URL with a token). */
  file(documentId: string, purpose: DocumentFilePurpose): Promise<Blob> {
    return this.api.getBlob(`/documents/${documentId}/file?purpose=${purpose}`);
  }
}
