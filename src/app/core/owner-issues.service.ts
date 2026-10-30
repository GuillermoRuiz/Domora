import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type {
  CreateOwnerIssueInput,
  OwnerIssueAttachment,
  OwnerIssueDetail,
  OwnerIssueList,
  OwnerIssueLocation,
  OwnerIssueQuery,
  SimilarIssue,
} from './owner-issues.models';

/** «Incidencias» of the signed-in owner (`/me/issues`) and the issue attachments. */
@Injectable({ providedIn: 'root' })
export class OwnerIssuesService {
  private api = inject(ApiClientService);

  list(query: OwnerIssueQuery = {}): Promise<OwnerIssueList> {
    return this.api.get<OwnerIssueList>('/me/issues', {
      estateId: query.estateId,
      q: query.q?.trim() || undefined,
      status: query.status?.length ? query.status.join(',') : undefined,
    });
  }

  detail(id: string): Promise<OwnerIssueDetail> {
    return this.api.get<OwnerIssueDetail>(`/me/issues/${id}`);
  }

  create(input: CreateOwnerIssueInput): Promise<OwnerIssueDetail> {
    return this.api.post<OwnerIssueDetail>('/me/issues', input);
  }

  locations(estateId: string): Promise<OwnerIssueLocation[]> {
    return this.api.get<OwnerIssueLocation[]>('/me/issues/locations', { estateId });
  }

  similar(estateId: string, q: string): Promise<SimilarIssue[]> {
    return this.api.get<SimilarIssue[]>('/me/issues/similar', { estateId, q });
  }

  reply(id: string, text: string): Promise<OwnerIssueDetail> {
    return this.api.post<OwnerIssueDetail>(`/me/issues/${id}/replies`, { text });
  }

  withdraw(id: string): Promise<OwnerIssueDetail> {
    return this.api.post<OwnerIssueDetail>(`/me/issues/${id}/withdraw`, {});
  }

  reopen(id: string): Promise<OwnerIssueDetail> {
    return this.api.post<OwnerIssueDetail>(`/me/issues/${id}/reopen`, {});
  }

  rate(id: string, rating: number, comment?: string): Promise<OwnerIssueDetail> {
    const trimmed = comment?.trim();
    return this.api.post<OwnerIssueDetail>(`/me/issues/${id}/rating`, trimmed ? { rating, comment: trimmed } : { rating });
  }

  /** «Me afecta también» en la incidencia de otro vecino (false lo deshace). */
  setAffected(id: string, affected: boolean): Promise<OwnerIssueDetail> {
    return affected
      ? this.api.put<OwnerIssueDetail>(`/me/issues/${id}/affected`, {})
      : this.api.delete<OwnerIssueDetail>(`/me/issues/${id}/affected`);
  }

  uploadAttachment(issueId: string, file: File): Promise<OwnerIssueAttachment> {
    return this.api.uploadFile<OwnerIssueAttachment>(`/issues/${issueId}/photos`, file);
  }

  downloadAttachment(issueId: string, attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/issues/${issueId}/photos/${attachmentId}/file`);
  }
}
