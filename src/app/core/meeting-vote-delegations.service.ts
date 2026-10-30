import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { MeetingVoteDelegation } from './models';

/**
 * Delegación de voto para una junta y una propiedad (art. 15.1 LPH) —
 * primer consumidor real de este patrón: `user-representations` (la
 * representación legal pesada, tutela/poder notarial) nunca llegó a tener
 * servicio de frontend porque nadie construyó cómo se crea una.
 */
@Injectable({ providedIn: 'root' })
export class MeetingVoteDelegationsService {
  private api = inject(ApiClientService);

  async list(meetingId: string): Promise<MeetingVoteDelegation[]> {
    return this.api.get<MeetingVoteDelegation[]>(`/meetings/${meetingId}/delegations`);
  }

  /** Titulares con voto de una propiedad — puebla el selector de delegador cuando actúa la gestora. */
  async listEligibleDelegators(meetingId: string, propertyId: string): Promise<{ userId: string; name: string }[]> {
    return this.api.get(`/meetings/${meetingId}/delegations/eligible-delegators`, { propertyId });
  }

  /**
   * `representativeEmail`, no un id: el representante no tiene por qué
   * tener vínculo con la finca (art. 15.1 LPH), así que no hay un
   * directorio del que elegirlo — el backend resuelve el email a un
   * usuario real y devuelve 404 si no existe cuenta. Un representante sin
   * cuenta se indica con `representativeName` + `representativeDni` (en
   * lugar del email, nunca los dos).
   */
  async create(
    meetingId: string,
    payload: {
      propertyId: string;
      delegatorUserId: string;
      representativeEmail?: string;
      representativeName?: string;
      representativeDni?: string;
      notes?: string;
    },
  ): Promise<MeetingVoteDelegation> {
    return this.api.post<MeetingVoteDelegation>(`/meetings/${meetingId}/delegations`, payload);
  }

  async revoke(meetingId: string, id: string, reason?: string): Promise<MeetingVoteDelegation> {
    return this.api.patch<MeetingVoteDelegation>(`/meetings/${meetingId}/delegations/${id}/revoke`, { reason });
  }

  async uploadDocument(meetingId: string, id: string, file: File): Promise<MeetingVoteDelegation> {
    return this.api.uploadFile<MeetingVoteDelegation>(`/meetings/${meetingId}/delegations/${id}/document`, file);
  }

  downloadDocument(meetingId: string, id: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/delegations/${id}/document/file`);
  }
}
