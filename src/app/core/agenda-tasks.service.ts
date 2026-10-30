import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  AgendaQuery,
  AgendaTask,
  AgendaTaskDetail,
  AgendaTaskList,
  AgendaTaskStatus,
  ChecklistItem,
  CreateAgendaTaskPayload,
  PersonRef,
  TaskAttachment,
  TaskComment,
  TaskLabel,
  UpdateAgendaTaskPayload,
} from './agenda-tasks.model';

/**
 * Agenda de tareas de la gestora (`/agenda/*`). Todo el ámbito —gestora,
 * comunidades accesibles, responsables válidos— lo impone el backend; este
 * servicio solo transporta. Las consultas siempre van acotadas por rango
 * (calendario).
 */
@Injectable({ providedIn: 'root' })
export class AgendaTasksService {
  private api = inject(ApiClientService);

  /**
   * Zona del navegador. Las tareas de día completo son fechas de calendario:
   * para saber qué días abarca un rango de instantes, el servidor necesita saber
   * en qué zona se está mirando.
   */
  private timezone(): string | undefined {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  }

  /** Convierte los filtros a query params (listas separadas por comas). */
  private toParams(query: AgendaQuery): Record<string, string | number | boolean | undefined> {
    return {
      from: query.from,
      to: query.to,
      estateId: query.estateId || undefined,
      assignee: query.assignee || undefined,
      status: query.status?.length ? query.status.join(',') : undefined,
      priority: query.priority?.length ? query.priority.join(',') : undefined,
      type: query.type?.length ? query.type.join(',') : undefined,
      labelIds: query.labelIds?.length ? query.labelIds.join(',') : undefined,
      q: query.q?.trim() || undefined,
      tz: this.timezone(),
    };
  }

  async list(query: AgendaQuery): Promise<AgendaTaskList> {
    const { body, headers } = await this.api.getWithHeaders<AgendaTask[]>('/agenda/tasks', this.toParams(query));
    return { items: body, truncated: headers.get('X-Agenda-Truncated') === 'true' };
  }

  get(id: string): Promise<AgendaTaskDetail> {
    return this.api.get<AgendaTaskDetail>(`/agenda/tasks/${id}`);
  }

  create(payload: CreateAgendaTaskPayload): Promise<AgendaTaskDetail> {
    return this.api.post<AgendaTaskDetail>('/agenda/tasks', payload);
  }

  update(id: string, patch: UpdateAgendaTaskPayload): Promise<AgendaTaskDetail> {
    return this.api.patch<AgendaTaskDetail>(`/agenda/tasks/${id}`, patch);
  }

  /** `occurrenceStart` solo para series: resuelve esa ocurrencia y no la serie entera. */
  /**
   * `restorePrevious` (solo con PENDIENTE): desmarcar una tarea completada la devuelve al estado
   * que tenía antes de completarse; el servidor lo recuerda.
   */
  setStatus(id: string, status: AgendaTaskStatus, occurrenceStart?: string, restorePrevious?: boolean): Promise<AgendaTaskDetail> {
    return this.api.patch<AgendaTaskDetail>(`/agenda/tasks/${id}/status`, { status, occurrenceStart, restorePrevious });
  }

  /** Resuelve una tarea de decisión (aprobar, confirmar…): es la única forma de cerrarla. El resultado lo valida el servidor según el tipo. */
  resolve(id: string, result: Record<string, unknown>): Promise<AgendaTaskDetail> {
    return this.api.post<AgendaTaskDetail>(`/agenda/tasks/${id}/resolution`, { result });
  }

  duplicate(id: string): Promise<AgendaTaskDetail> {
    return this.api.post<AgendaTaskDetail>(`/agenda/tasks/${id}/duplicate`, {});
  }

  remove(id: string): Promise<void> {
    return this.api.delete<void>(`/agenda/tasks/${id}`);
  }

  // ── Comentarios, checklist y adjuntos ────────────────────────────────────

  addComment(id: string, text: string): Promise<TaskComment> {
    return this.api.post<TaskComment>(`/agenda/tasks/${id}/comments`, { text });
  }

  deleteComment(id: string, commentId: string): Promise<void> {
    return this.api.delete<void>(`/agenda/tasks/${id}/comments/${commentId}`);
  }

  addChecklistItem(id: string, text: string): Promise<ChecklistItem> {
    return this.api.post<ChecklistItem>(`/agenda/tasks/${id}/checklist`, { text });
  }

  updateChecklistItem(id: string, itemId: string, patch: { text?: string; done?: boolean }): Promise<ChecklistItem> {
    return this.api.patch<ChecklistItem>(`/agenda/tasks/${id}/checklist/${itemId}`, patch);
  }

  deleteChecklistItem(id: string, itemId: string): Promise<void> {
    return this.api.delete<void>(`/agenda/tasks/${id}/checklist/${itemId}`);
  }

  uploadAttachment(id: string, file: File): Promise<TaskAttachment> {
    return this.api.uploadFile<TaskAttachment>(`/agenda/tasks/${id}/attachments`, file);
  }

  downloadAttachment(id: string, attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/agenda/tasks/${id}/attachments/${attachmentId}/file`);
  }

  deleteAttachment(id: string, attachmentId: string): Promise<void> {
    return this.api.delete<void>(`/agenda/tasks/${id}/attachments/${attachmentId}`);
  }

  // ── Catálogos ────────────────────────────────────────────────────────────

  listAssignees(): Promise<PersonRef[]> {
    return this.api.get<PersonRef[]>('/agenda/assignees');
  }

  listLabels(): Promise<TaskLabel[]> {
    return this.api.get<TaskLabel[]>('/agenda/labels');
  }

  createLabel(name: string): Promise<TaskLabel> {
    return this.api.post<TaskLabel>('/agenda/labels', { name });
  }

  deleteLabel(id: string): Promise<void> {
    return this.api.delete<void>(`/agenda/labels/${id}`);
  }
}
