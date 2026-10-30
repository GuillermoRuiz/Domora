import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { CommunitySummary, PropertyEvent, PropertyOverview } from './owner-community.models';

/** Datos de «Mi comunidad» (rol C): fichas y eventos de una propiedad y resumen de su finca. */
@Injectable({ providedIn: 'root' })
export class OwnerCommunityService {
  private api = inject(ApiClientService);

  /** Próximo recibo, solicitudes, próxima junta y documentos nuevos de la propiedad. */
  getPropertyOverview(propertyId: string): Promise<PropertyOverview> {
    return this.api.get<PropertyOverview>(`/properties/${propertyId}/my-overview`);
  }

  /** Las mismas fichas sobre todas las propiedades del propietario («Todas mis propiedades»). */
  getOwnerOverview(): Promise<PropertyOverview> {
    return this.api.get<PropertyOverview>('/properties/my-overview');
  }

  /** Lo próximo que afecta a la propiedad (90 días, máximo 10), el más cercano primero. */
  getPropertyEvents(propertyId: string): Promise<PropertyEvent[]> {
    return this.api.get<PropertyEvent[]>(`/properties/${propertyId}/my-events`);
  }

  /** Datos de presentación de la finca e indicadores agregados (nunca datos de otros propietarios). */
  getCommunitySummary(estateId: string): Promise<CommunitySummary> {
    return this.api.get<CommunitySummary>(`/estates/${estateId}/community-summary`);
  }
}
