import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { NotificationItem, NotificationPreference, NotificationSummary, TaskItem } from './models';

/**
 * Bandeja de notificaciones y tareas del usuario en sesión. Complementa a
 * `ResourceReadsService` (feed de Alertas derivado): esto es la bandeja
 * persistida — solicitudes, mensajes, incidencias, juntas, inspecciones,
 * comunicados urgentes — más las tareas del administrador (`/tasks`, solo
 * roles A/B).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private api = inject(ApiClientService);

  list(params: { unread?: boolean; before?: string; limit?: number } = {}): Promise<NotificationItem[]> {
    return this.api.get<NotificationItem[]>('/notifications', params);
  }

  summary(): Promise<NotificationSummary> {
    return this.api.get<NotificationSummary>('/notifications/summary');
  }

  markRead(id: string): Promise<void> {
    return this.api.post<void>(`/notifications/${id}/read`, {});
  }

  markAllRead(): Promise<void> {
    return this.api.post<void>('/notifications/read-all', {});
  }

  /** Solo gestora (B) y soporte (A) — los propietarios ajustan las suyas por vivienda. */
  getPreferences(): Promise<NotificationPreference[]> {
    return this.api.get<NotificationPreference[]>('/notifications/preferences');
  }

  updatePreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
    return this.api.put<NotificationPreference[]>('/notifications/preferences', { preferences });
  }

  /** Solo gestora (B) y soporte (A). */
  listTasks(): Promise<TaskItem[]> {
    return this.api.get<TaskItem[]>('/tasks');
  }
}
