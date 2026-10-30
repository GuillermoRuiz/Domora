import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import { AlertItem, AlertSourceType, ActivityItem, ActivityLogEntry } from './models';

/**
 * Mecanismo genérico de "¿ya lo vio este usuario?" (`isResourceRead`/
 * `markResourceRead`) más los tres dominios que se apoyan en él
 * (Communications, Documents, Alerts) y el feed de actividad — agrupados
 * juntos a propósito para no reimplementar el mecanismo genérico en tres
 * servicios distintos. Los CRUD reales de comunicados/documentos (crear,
 * editar, listar) viven en `ComunicadosService`, no acá — esto es solo el
 * estado de "leído/no leído".
 */
@Injectable({ providedIn: 'root' })
export class ResourceReadsService {
  private api = inject(ApiClientService);

  // TODO(backend): no hay GET de resource-reads individuales; el estado de
  // lectura llega ya resuelto en las listas (alerts.read, communications.read,
  // documents.isNew). Este helper devuelve false hasta que exista endpoint.
  async isResourceRead(_userId: string, _sourceType: AlertSourceType, _sourceId: string): Promise<boolean> {
    return false;
  }

  async markResourceRead(_userId: string, sourceType: AlertSourceType, sourceId: string): Promise<void> {
    await this.api.post('/resource-reads', { sourceType, sourceId });
  }

  /** @deprecated usar `isResourceRead`. */
  isAlertRead(userId: string, sourceType: AlertSourceType, sourceId: string): Promise<boolean> {
    return this.isResourceRead(userId, sourceType, sourceId);
  }

  /** @deprecated usar `markResourceRead`. */
  markAlertRead(userId: string, sourceType: AlertSourceType, sourceId: string): Promise<void> {
    return this.markResourceRead(userId, sourceType, sourceId);
  }

  async markAllAlertsRead(_userId?: string): Promise<void> {
    await this.api.post('/alerts/read-all', {});
  }

  // ── Communications (lectura por usuario) ────────────────────────────────
  isCommunicationRead(userId: string, communicationId: string): Promise<boolean> {
    return this.isResourceRead(userId, 'communication', communicationId);
  }

  markCommunicationRead(userId: string, communicationId: string): Promise<void> {
    return this.markResourceRead(userId, 'communication', communicationId);
  }

  // ── Documents (lectura por usuario) ─────────────────────────────────────
  async isDocumentUnseen(userId: string, documentId: string): Promise<boolean> {
    return !(await this.isResourceRead(userId, 'document', documentId));
  }

  markDocumentRead(userId: string, documentId: string): Promise<void> {
    return this.markResourceRead(userId, 'document', documentId);
  }

  /** Descarga real del fichero — el nombre sugerido lo pone el backend vía Content-Disposition. */
  downloadDocumentFile(documentId: string): Promise<Blob> {
    return this.api.getBlob(`/documents/${documentId}/file`);
  }

  // ── Alerts (vista derivada server-side) ─────────────────────────────────
  async listAlertsForUser(_userId?: string, limit?: number): Promise<AlertItem[]> {
    const alerts = await this.api.get<any[]>('/alerts', limit ? { limit } : undefined);
    return alerts.map(a => ({ ...a, date: d(a.date) }));
  }

  // ── Activity feed (rol C "Actividad reciente") ──────────────────────────
  async listActivityForUser(_userId?: string, limit = 10): Promise<ActivityItem[]> {
    const items = await this.api.get<any[]>('/activity', { limit });
    return items.map(i => ({ ...i, date: d(i.date) }));
  }

  // TODO(backend): no hay endpoint de escritura en activity_log — los eventos
  // se registran server-side en cada operación de dominio.
  async logActivity(entry: Omit<ActivityLogEntry, 'id'>): Promise<ActivityLogEntry> {
    return { ...entry, id: 'act' + Date.now() };
  }
}
