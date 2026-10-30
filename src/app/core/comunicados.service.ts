import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  Communication, Document as AppDocument, CommunicationCategory, CommunicationSignerRole,
  CommunicationReply, CommunicationAttachment, CommunicationReadReceipt,
} from './models';

/**
 * CRUD real de comunicados y documentos de una finca (crear, editar,
 * listar, subir). El estado de "leído/no leído" por usuario vive aparte,
 * en `ResourceReadsService` — este servicio no lo toca.
 */
@Injectable({ providedIn: 'root' })
export class ComunicadosService {
  private api = inject(ApiClientService);

  /** Paginado en servidor: una finca acumula comunicados sin techo. `filter` por defecto: 'active' (el tablón compartido). */
  async listCommunicationsByEstate(
    estateId: string,
    opts?: { page?: number; pageSize?: number; filter?: 'active' | 'archived' | 'all'; category?: CommunicationCategory },
  ): Promise<{ items: (Communication & { read: boolean })[]; total: number; page: number; pageSize: number }> {
    return this.api.get(`/estates/${estateId}/communications`, {
      page: opts?.page,
      pageSize: opts?.pageSize,
      filter: opts?.filter,
      category: opts?.category,
    });
  }

  createCommunication(
    estateId: string,
    input: {
      title: string; body: string; activeUntil?: string;
      category?: CommunicationCategory; targetPropertyId?: string;
      isLegalNotice?: boolean; legalNoticeSignerRole?: CommunicationSignerRole;
      legalNoticeSignerName?: string; legalNoticeReason?: string; legalNoticeCountersignedByPresident?: boolean;
    },
  ): Promise<Communication> {
    return this.api.post(`/estates/${estateId}/communications`, input);
  }

  updateCommunication(
    id: string,
    input: {
      title?: string; body?: string; activeUntil?: string | null;
      category?: CommunicationCategory; targetPropertyId?: string | null;
      isLegalNotice?: boolean; legalNoticeSignerRole?: CommunicationSignerRole;
      legalNoticeSignerName?: string; legalNoticeReason?: string; legalNoticeCountersignedByPresident?: boolean;
    },
  ): Promise<Communication> {
    return this.api.patch(`/communications/${id}`, input);
  }

  async deleteCommunication(id: string): Promise<void> {
    await this.api.delete(`/communications/${id}`);
  }

  /** Solo rol A/B — archivar/desarchivar cualquier comunicado (toggle). */
  async setCommunicationArchived(id: string, archived: boolean): Promise<void> {
    await this.api.patch(`/communications/${id}/archive`, { archived });
  }

  /** Solo rol A/B — fijar/desfijar (toggle). */
  async setCommunicationPinned(id: string, pinned: boolean): Promise<void> {
    await this.api.patch(`/communications/${id}/pin`, { pinned });
  }

  /** Cualquier rol con acceso — responder al comunicado propio o ajeno. */
  addCommunicationReply(id: string, text: string): Promise<CommunicationReply> {
    return this.api.post(`/communications/${id}/replies`, { text });
  }

  /** La propia siempre se puede borrar; A/B modera cualquiera. */
  async deleteCommunicationReply(id: string, replyId: string): Promise<void> {
    await this.api.delete(`/communications/${id}/replies/${replyId}`);
  }

  /** Solo rol A/B — quién ha leído este comunicado (engagement + defensa legal). */
  listCommunicationReads(id: string): Promise<CommunicationReadReceipt[]> {
    return this.api.get(`/communications/${id}/reads`);
  }

  listCommunicationAttachments(id: string): Promise<CommunicationAttachment[]> {
    return this.api.get(`/communications/${id}/attachments`);
  }

  uploadCommunicationAttachment(id: string, file: File, title?: string): Promise<CommunicationAttachment> {
    return this.api.uploadFile<CommunicationAttachment>(`/communications/${id}/attachments`, file, { title });
  }

  downloadCommunicationAttachmentFile(id: string, attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/communications/${id}/attachments/${attachmentId}/file`);
  }

  /** Paginado en servidor: una finca acumula documentos sin techo. */
  async listDocumentsByEstate(
    estateId: string,
    opts?: { page?: number; pageSize?: number },
  ): Promise<{ items: (AppDocument & { isNew: boolean })[]; total: number; page: number; pageSize: number }> {
    return this.api.get(`/estates/${estateId}/documents`, { page: opts?.page, pageSize: opts?.pageSize });
  }

  /** `targetPropertyId` ausente/undefined = documento general, visible a toda la finca. */
  async uploadDocument(estateId: string, file: File, opts: { title?: string; type?: string; targetPropertyId?: string }): Promise<AppDocument> {
    return this.api.uploadFile<AppDocument>(`/estates/${estateId}/documents/upload`, file, {
      title: opts.title,
      type: opts.type,
      targetPropertyId: opts.targetPropertyId,
    });
  }
}
