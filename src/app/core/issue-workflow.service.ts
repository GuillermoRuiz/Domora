import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { RegisterInteractionBody } from './issue-interaction.builder';
import { IssueJourneyView, IssueSituationSummary, IssueSituationView, ResolutionRoute } from './issue-workflow.models';

export interface RequesterNoticePreview {
  title: string;
  body: string;
}

export interface RegisterInteractionResult {
  eventId: string;
  effects: { type: string; ref?: string }[];
}

/**
 * Lectura de las proyecciones del workflow de Incidencias y las dos operaciones de gestión que la pantalla ofrece
 * (registrar una gestión externa, decidir la vía). No guarda estado: lo que devuelve el backend es lo que se pinta.
 */
@Injectable({ providedIn: 'root' })
export class IssueWorkflowService {
  private readonly api = inject(ApiClientService);

  /** Situación, siguiente paso y quién tiene la pelota de una incidencia. */
  situation(issueId: string): Promise<IssueSituationView> {
    return this.api.get<IssueSituationView>(`/issues/${issueId}/situation`);
  }

  /** Lo mismo para una página de incidencias de UNA finca (máx. 200 ids por llamada). */
  situations(estateId: string, ids: string[]): Promise<Record<string, IssueSituationView>> {
    if (ids.length === 0) return Promise.resolve({});
    return this.api.get<Record<string, IssueSituationView>>(`/estates/${estateId}/issues/situations`, { ids: ids.slice(0, 200).join(',') });
  }

  summary(estateId: string): Promise<IssueSituationSummary> {
    return this.api.get<IssueSituationSummary>(`/estates/${estateId}/issues/situation-summary`);
  }

  /** Recorrido de la incidencia: lo que ocurrió, lo que toca ahora y el siguiente paso previsible. */
  journey(issueId: string): Promise<IssueJourneyView> {
    return this.api.get<IssueJourneyView>(`/issues/${issueId}/journey`);
  }

  addMilestone(issueId: string, body: { label: string; linkedStatus?: string; afterKey?: string }): Promise<IssueJourneyView> {
    return this.api.post<IssueJourneyView>(`/issues/${issueId}/journey/milestones`, body);
  }

  /** `ref`: id de un hito propio o clave de uno del sistema (este solo cambia de nombre). */
  updateMilestone(issueId: string, ref: string, body: { label?: string; done?: boolean; position?: number; linkedStatus?: string | null }): Promise<IssueJourneyView> {
    return this.api.patch<IssueJourneyView>(`/issues/${issueId}/journey/milestones/${encodeURIComponent(ref)}`, body);
  }

  removeMilestone(issueId: string, ref: string): Promise<IssueJourneyView> {
    return this.api.delete<IssueJourneyView>(`/issues/${issueId}/journey/milestones/${encodeURIComponent(ref)}`);
  }

  /** `POST /issues/:id/interactions`: una gestión externa y, opcionalmente, sus consecuencias (todo o nada). */
  registerInteraction(issueId: string, body: RegisterInteractionBody): Promise<RegisterInteractionResult> {
    return this.api.post<RegisterInteractionResult>(`/issues/${issueId}/interactions`, body);
  }

  /**
   * `POST /issues/:id/requester-notices/preview`: el texto EXACTO que recibirá quien reportó la incidencia, con el mismo
   * renderizado que el envío real. No envía nada ni crea eventos.
   */
  previewRequesterNotice(issueId: string, body: { template: string; when?: string; label?: string; text?: string }): Promise<RequesterNoticePreview> {
    return this.api.post<RequesterNoticePreview>(`/issues/${issueId}/requester-notices/preview`, body);
  }

  /** `PUT /issues/:id/resolution-route`: una persona decide la vía (`null` = por determinar). Queda como `route_decided`. */
  decideRoute(issueId: string, route: ResolutionRoute | null, reason?: string): Promise<{ resolutionRoute: ResolutionRoute | null; changed: boolean }> {
    return this.api.put<{ resolutionRoute: ResolutionRoute | null; changed: boolean }>(`/issues/${issueId}/resolution-route`, {
      route,
      ...(reason ? { reason } : {}),
    });
  }
}
