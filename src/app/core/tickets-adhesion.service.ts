import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { ESTATE_TYPE_FROM_API } from './api-shared';
import { AdhesionRequest } from './models';

/** Owner adhesion requests to an estate. */
@Injectable({ providedIn: 'root' })
export class TicketsAdhesionService {
  private api = inject(ApiClientService);

  listAdhesionRequestsByEstate(estateId: string): Promise<AdhesionRequest[]> {
    return this.api.get<AdhesionRequest[]>(`/estates/${estateId}/adhesion-requests`);
  }

  listPendingAdhesionRequestsByEstate(estateId: string): Promise<AdhesionRequest[]> {
    return this.api.get<AdhesionRequest[]>(`/estates/${estateId}/adhesion-requests`, { status: 'pending' });
  }

  /** Todas las solicitudes pendientes de todas las fincas accesibles, con la finca embebida. */
  async listAllPendingAdhesionRequests(): Promise<AdhesionRequest[]> {
    const raw = await this.api.get<any[]>('/adhesion-requests');
    return raw.map((r) => ({
      ...r,
      estate: r.estate
        ? { ...r.estate, type: ESTATE_TYPE_FROM_API[r.estate.type] ?? r.estate.type }
        : r.estate,
    }));
  }

  async approveAdhesion(estateId: string, requestId: string): Promise<void> {
    await this.api.post(`/estates/${estateId}/adhesion-requests/${requestId}/approve`, {});
  }

  async rejectAdhesion(estateId: string, requestId: string, notes?: string): Promise<void> {
    await this.api.post(`/estates/${estateId}/adhesion-requests/${requestId}/reject`, { notes });
  }
}
