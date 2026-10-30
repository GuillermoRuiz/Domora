import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import type { ClientHealthOverview, OfficeHealth } from './models';
import { OfficeSetupService, type OfficeCompletenessDetail } from './office-setup.service';

function num(value: unknown): number {
  return Number(value ?? 0);
}

function mapOfficeHealth(raw: any): OfficeHealth {
  return {
    ...raw,
    createdAt: d(raw.createdAt),
    completeness: num(raw.completeness),
    salud: raw.salud === null || raw.salud === undefined ? null : Number(raw.salud),
    motivo: raw.motivo ?? null,
    signals: (raw.signals ?? []).map((s: any) => ({
      ...s,
      score: s.score === null || s.score === undefined ? null : Number(s.score),
      weight: num(s.weight),
      deduction: num(s.deduction),
    })),
    attention: raw.attention ?? [],
  };
}

/**
 * Role A insights on one or every despacho (odd/tasks/role-a-panel.md S10, S14, S7):
 * salud, «En riesgo», «Requieren atención» and «qué falta configurar».
 */
@Injectable({ providedIn: 'root' })
export class AdminInsightsService {
  private api = inject(ApiClientService);
  private officeSetup = inject(OfficeSetupService);

  async healthOverview(): Promise<ClientHealthOverview> {
    const raw = await this.api.get<any>('/client-health/offices');
    return {
      atRiskBelow: num(raw.atRiskBelow),
      churnRisk: num(raw.churnRisk),
      offices: (raw.offices ?? []).map(mapOfficeHealth),
    };
  }

  async officeHealth(administratorId: string): Promise<OfficeHealth> {
    return mapOfficeHealth(await this.api.get<any>(`/client-health/offices/${administratorId}`));
  }

  /** «Qué falta configurar»: despacho steps and each estate's checklist. */
  officeCompleteness(administratorId: string): Promise<OfficeCompletenessDetail> {
    return this.officeSetup.getOffice(administratorId);
  }
}
