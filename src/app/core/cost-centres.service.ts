import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { CostCentre } from './models';

/** Centros de coste — dimensión transversal de presupuestación por finca (piscina, ascensor portal A...). */
@Injectable({ providedIn: 'root' })
export class CostCentresService {
  private api = inject(ApiClientService);

  async listCostCentres(estateId: string): Promise<CostCentre[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/cost-centres`);
    return rows.map((c: any): CostCentre => ({
      ...c,
      budgeted: c.budgeted !== null && c.budgeted !== undefined ? Number(c.budgeted) : null,
      executed: c.executed !== undefined ? Number(c.executed) : undefined,
    }));
  }

  async createCostCentre(estateId: string, payload: { name: string; description?: string }): Promise<CostCentre> {
    return this.api.post<CostCentre>(`/estates/${estateId}/cost-centres`, payload);
  }

  async updateCostCentre(estateId: string, costCentreId: string, patch: Partial<{
    name: string; description: string; status: CostCentre['status'];
  }>): Promise<CostCentre> {
    return this.api.patch<CostCentre>(`/estates/${estateId}/cost-centres/${costCentreId}`, patch);
  }
}
