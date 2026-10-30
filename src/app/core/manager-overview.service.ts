import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type {
  EconomicSummary, ManagerActivity, ManagerKpis, ManagerMilestones, PendingToday, PerformanceRanking,
} from './manager-overview.models';

/**
 * Datos de la «Vista general» del gestor. Sin `estateId` agregan todas sus comunidades; con él
 * (la elegida en el selector) solo esa. No hay refresco automático: se piden al entrar.
 */
@Injectable({ providedIn: 'root' })
export class ManagerOverviewService {
  private api = inject(ApiClientService);

  private params(estateId: string | null): Record<string, string> | undefined {
    return estateId ? { estateId } : undefined;
  }

  getKpis(estateId: string | null): Promise<ManagerKpis> {
    return this.api.get<ManagerKpis>('/manager-overview/kpis', this.params(estateId));
  }
  getPendingToday(estateId: string | null): Promise<PendingToday> {
    return this.api.get<PendingToday>('/manager-overview/pending-today', this.params(estateId));
  }
  getMilestones(estateId: string | null): Promise<ManagerMilestones> {
    return this.api.get<ManagerMilestones>('/manager-overview/milestones', this.params(estateId));
  }
  getEconomicSummary(estateId: string | null): Promise<EconomicSummary> {
    return this.api.get<EconomicSummary>('/manager-overview/economic-summary', this.params(estateId));
  }
  getActivity(estateId: string | null): Promise<ManagerActivity> {
    return this.api.get<ManagerActivity>('/manager-overview/activity', this.params(estateId));
  }
  /** El Top 10 es siempre el de todas las comunidades; `estateId` solo señala la elegida. */
  getPerformance(estateId: string | null): Promise<PerformanceRanking> {
    return this.api.get<PerformanceRanking>('/manager-overview/performance', this.params(estateId));
  }
}
