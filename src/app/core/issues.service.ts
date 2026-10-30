import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import { Issue, IssueStatus, IssueType, IssueTimelineEntry, IssueProviderAssignment, IssueNotification } from './models';

const ISSUE_STATUS_FROM_API: Record<string, IssueStatus> = {
  Abierta: 'Abierta', EnReparacion: 'En reparación',
  PendienteProveedor: 'Pendiente proveedor', PendienteInformacion: 'Pendiente de información',
  Resuelta: 'Resuelta', Cerrada: 'Cerrada', Retirada: 'Retirada',
};
const ISSUE_STATUS_TO_API: Record<string, string> = {
  'Abierta': 'Abierta', 'En reparación': 'EnReparacion',
  'Pendiente proveedor': 'PendienteProveedor', 'Pendiente de información': 'PendienteInformacion',
  'Resuelta': 'Resuelta', 'Cerrada': 'Cerrada', 'Retirada': 'Retirada',
};
const ISSUE_TYPE_FROM_API: Record<string, IssueType> = {
  Averia: 'Avería', Ruido: 'Ruido', DanoEstructural: 'Daño estructural',
  Fuga: 'Fuga', Seguridad: 'Seguridad', Limpieza: 'Limpieza', Otro: 'Otro',
};
const ISSUE_TYPE_TO_API: Record<string, string> = {
  'Avería': 'Averia', 'Ruido': 'Ruido', 'Daño estructural': 'DanoEstructural',
  'Fuga': 'Fuga', 'Seguridad': 'Seguridad', 'Limpieza': 'Limpieza', 'Otro': 'Otro',
};

function mapIssue(i: any): Issue {
  return {
    ...i,
    type: ISSUE_TYPE_FROM_API[i.type] ?? i.type,
    status: ISSUE_STATUS_FROM_API[i.status] ?? i.status,
    ...(i.statusBeforeInfoRequest ? { statusBeforeInfoRequest: ISSUE_STATUS_FROM_API[i.statusBeforeInfoRequest] ?? i.statusBeforeInfoRequest } : {}),
    date: d(i.date),
    photos: i.photos ?? [],
    timeline: (i.timeline ?? []).map((e: any) => ({ ...e, at: e.date, date: d(e.date) })),
  };
}

/** Incidencias de una finca: alta, seguimiento, asignación de proveedor y avisos a propietarios. */
@Injectable({ providedIn: 'root' })
export class IssuesService {
  private api = inject(ApiClientService);

  // ── Issues ──────────────────────────────────────────────────────────────
  /**
   * Paginado en servidor: las incidencias de una finca no se archivan nunca,
   * así que el histórico crece sin techo. Devuelve también el total para que
   * la vista pueda decir cuántas quedan sin mostrar en lugar de truncar en
   * silencio.
   */
  async listIssuesForEstate(
    estateId: string,
    opts?: { page?: number; pageSize?: number; assetId?: string; situation?: string },
  ): Promise<{ items: Issue[]; total: number; page: number; pageSize: number }> {
    const res = await this.api.get<{ items: any[]; total: number; page: number; pageSize: number }>(
      `/estates/${estateId}/issues`,
      { page: opts?.page, pageSize: opts?.pageSize, assetId: opts?.assetId, situation: opts?.situation },
    );
    return { ...res, items: res.items.map(mapIssue) };
  }

  /** `DELETE /issues/:id`: la gestión elimina la incidencia (borrado lógico: deja de verse en todas partes). */
  deleteIssue(id: string): Promise<{ deleted: true }> {
    return this.api.delete<{ deleted: true }>(`/issues/${id}`);
  }

  async findIssueById(id: string): Promise<Issue | null> {
    const issue = await this.api.getOrNull<any>(`/issues/${id}`);
    return issue ? mapIssue(issue) : null;
  }

  /**
   * Una incidencia es siempre de la COMUNIDAD (finca), no de una vivienda. La puede dar de alta la gestión o cualquier miembro de la
   * comunidad; quien la reporta queda como reportante (no como dueño).
   */
  async createIssue(estateId: string, input: {
    type: IssueType; title: string; description: string; priority: 'Normal' | 'Urgente';
    /** Instalación afectada (solo gestión; opcional). */
    assetId?: string;
    /** Zona o instalación afectada, en texto. */
    location?: string;
    /** Por dónde llegó el aviso, su referencia y quien avisa (solo gestión; opcionales). */
    channel?: 'form' | 'call' | 'email';
    sourceRef?: string;
    /** La persona con cuenta que avisó (un propietario de la comunidad): queda como reportante y recibe los avisos. */
    reporterUserId?: string;
    reporterName?: string;
    reporterContact?: string;
    /** Vía de gestión decidida al crear (solo gestión): se aplica en la misma petición. */
    resolutionRoute?: string;
    routeReason?: string;
  }): Promise<Issue> {
    const raw = await this.api.post<any>(`/estates/${estateId}/issues`, {
      type: ISSUE_TYPE_TO_API[input.type] ?? input.type,
      title: input.title,
      description: input.description,
      priority: input.priority,
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      ...(input.reporterUserId ? { reporterUserId: input.reporterUserId } : {}),
      ...(input.reporterName ? { reporterName: input.reporterName } : {}),
      ...(input.reporterContact ? { reporterContact: input.reporterContact } : {}),
      ...(input.resolutionRoute ? { resolutionRoute: input.resolutionRoute } : {}),
      ...(input.routeReason ? { routeReason: input.routeReason } : {}),
    });
    return mapIssue(raw);
  }

  /** Sube una foto a una incidencia que el usuario reportó. */
  async uploadIssuePhoto(issueId: string, file: File): Promise<{ id: string; issueId: string; uploadedAt: string }> {
    return this.api.uploadFile<{ id: string; issueId: string; uploadedAt: string }>(`/issues/${issueId}/photos`, file);
  }

  /** Vincula la incidencia a una instalación de su finca, o la desvincula con `null`. */
  async setIssueAsset(issueId: string, assetId: string | null): Promise<Issue> {
    const raw = await this.api.patch<any>(`/issues/${issueId}/asset`, { assetId });
    return mapIssue(raw);
  }

  async updateIssueStatus(issueId: string, status: IssueStatus): Promise<Issue> {
    const raw = await this.api.patch<any>(`/issues/${issueId}/status`, {
      status: ISSUE_STATUS_TO_API[status] ?? status,
    });
    return mapIssue(raw);
  }

  async updateIssueBudget(issueId: string, input: {
    budgetAmount?: number; budgetDescription?: string; budgetApproved?: boolean;
  }): Promise<Issue> {
    const raw = await this.api.patch<any>(`/issues/${issueId}/budget`, input);
    return mapIssue(raw);
  }

  /** `internal` (solo la gestión) deja la nota fuera de lo que ven quien avisó y los vecinos. */
  async addIssueTimelineEntry(issueId: string, text: string, opts?: { internal?: boolean }): Promise<IssueTimelineEntry> {
    const entry = await this.api.post<any>(`/issues/${issueId}/timeline`, {
      text,
      ...(opts?.internal ? { internal: true } : {}),
    });
    return { ...entry, at: entry.date, date: d(entry.date) };
  }

  /** Contenido de una foto de la incidencia (el endpoint exige sesión, no sirve como `src` directo). */
  issuePhotoBlob(issueId: string, photoId: string): Promise<Blob> {
    return this.api.getBlob(`/issues/${issueId}/photos/${photoId}/file`);
  }

  /** La gestión pide información a quien avisó: la incidencia queda en «Pendiente de información». */
  async requestIssueInfo(issueId: string, text: string): Promise<Issue> {
    const raw = await this.api.post<any>(`/issues/${issueId}/request-info`, { text });
    return mapIssue(raw);
  }

  // ── Issue provider assignments ───────────────────────────────────────────
  async currentIssueProvider(issueId: string): Promise<IssueProviderAssignment | null> {
    return this.api.getOrNull<IssueProviderAssignment>(`/issues/${issueId}/provider`);
  }

  listIssueProviderHistory(issueId: string): Promise<IssueProviderAssignment[]> {
    return this.api.get<IssueProviderAssignment[]>(`/issues/${issueId}/provider/history`);
  }

  assignIssueProvider(input: Omit<IssueProviderAssignment, 'id' | 'unassignedAt'>): Promise<IssueProviderAssignment> {
    return this.api.post<IssueProviderAssignment>(`/issues/${input.issueId}/provider`, {
      supplierId: input.supplierId ?? undefined,
      providerNameSnapshot: input.providerNameSnapshot,
      categorySnapshot: input.categorySnapshot || undefined,
      phoneSnapshot: input.phoneSnapshot || undefined,
      // '' no es una fecha válida para @IsDateString() — @IsOptional() solo
      // se salta la validación si el valor es undefined, no si es ''.
      estimatedResolutionDate: input.estimatedResolutionDate || undefined,
    });
  }

  // ── Issue notifications ──────────────────────────────────────────────────
  listIssueNotifications(issueId: string): Promise<IssueNotification[]> {
    return this.api.get<IssueNotification[]>(`/issues/${issueId}/notifications`);
  }

  async countIssueNotifications(issueId: string): Promise<number> {
    return (await this.listIssueNotifications(issueId)).length;
  }

  async lastIssueNotification(issueId: string): Promise<IssueNotification | null> {
    const all = await this.listIssueNotifications(issueId);
    return all[0] ?? null;
  }

  sendIssueNotification(input: Omit<IssueNotification, 'id'>): Promise<IssueNotification> {
    return this.api.post<IssueNotification>(`/issues/${input.issueId}/notifications`, {
      recipientsCount: input.recipientsCount,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
    });
  }
}
