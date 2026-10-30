import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { VoteSession, OpenVoteSessionPayload, CastVotePayload, RegisterVotePayload, VoteResponseEntry, PropertyDebt, VotingRight } from './models';

/**
 * Motor de votación real del orden del día (Fase 2.1). Reutiliza el mismo
 * concepto de elegibilidad por propiedad que asistencia/delegaciones — el
 * backend valida quién puede votar por cuál propiedad, esto solo transporta.
 */
@Injectable({ providedIn: 'root' })
export class VoteSessionsService {
  private api = inject(ApiClientService);

  async list(meetingId: string): Promise<VoteSession[]> {
    return this.api.get<VoteSession[]>(`/meetings/${meetingId}/vote-sessions`);
  }

  /** Qué votó cada propiedad en la sesión — solo gestora (A/B). */
  async listResponses(meetingId: string, sessionId: string): Promise<VoteResponseEntry[]> {
    return this.api.get<VoteResponseEntry[]>(`/meetings/${meetingId}/vote-sessions/${sessionId}/responses`);
  }

  /**
   * La gestora emite o cambia el voto de una propiedad presente o representada —
   * solo mientras la votación está abierta; el backend rechaza las ausentes.
   */
  async registerVote(meetingId: string, sessionId: string, payload: RegisterVotePayload): Promise<void> {
    await this.api.post(`/meetings/${meetingId}/vote-sessions/${sessionId}/responses`, payload);
  }

  /** Propiedades con deuda vencida (art. 15.2 LPH) — solo gestora (A/B). */
  async listDebts(meetingId: string): Promise<PropertyDebt[]> {
    return this.api.get<PropertyDebt[]>(`/meetings/${meetingId}/vote-sessions/debts`);
  }

  /** ¿Puede votar por esa propiedad quien consulta? Solo responde a quien puede actuar por ella. */
  async votingRight(meetingId: string, propertyId: string): Promise<VotingRight> {
    return this.api.get<VotingRight>(`/meetings/${meetingId}/vote-sessions/voting-right`, { propertyId });
  }

  async open(meetingId: string, payload: OpenVoteSessionPayload): Promise<VoteSession> {
    return this.api.post<VoteSession>(`/meetings/${meetingId}/vote-sessions`, payload);
  }

  async castVote(meetingId: string, sessionId: string, payload: CastVotePayload): Promise<void> {
    await this.api.post(`/meetings/${meetingId}/vote-sessions/${sessionId}/vote`, payload);
  }

  async close(meetingId: string, sessionId: string): Promise<VoteSession> {
    return this.api.patch<VoteSession>(`/meetings/${meetingId}/vote-sessions/${sessionId}/close`, {});
  }
}
