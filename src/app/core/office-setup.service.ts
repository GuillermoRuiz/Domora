import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from './api-client.service';

export type OfficeSetupStepKey = 'contact' | 'billing' | 'payment' | 'estates' | 'team' | 'twoFactor';
export type SetupWeight = 'required' | 'recommended' | 'info';
export type SetupStatus = 'done' | 'pending' | 'warning';

export interface OfficeSetupStep {
  key: OfficeSetupStepKey;
  weight: SetupWeight;
  status: SetupStatus;
  done?: number;
}

export interface EstateSetupStepView {
  key: string;
  weight: SetupWeight;
  status: SetupStatus;
  done?: number;
  total?: number;
}

/** Percentages 0-100 (one decimal). Mirrors `CompletenessService` in the backend. */
export interface OfficeCompleteness {
  administratorId: string;
  name: string;
  office: number;
  estates: number;
  total: number;
  estateCount: number;
  onboardingComplete: boolean;
  includedInAverage: boolean;
}

export interface OfficeCompletenessDetail extends OfficeCompleteness {
  officeSteps: OfficeSetupStep[];
  estateDetails: { estateId: string; name: string; percent: number; complete: boolean; steps: EstateSetupStepView[] }[];
}

export interface CompletenessOverview {
  average: number | null;
  offices: OfficeCompleteness[];
}

/** Steps still to do that count for the completitud (required + recommended; `info` never counts). */
export function pendingOfficeSteps(steps: OfficeSetupStep[]): number {
  return steps.filter((s) => s.weight !== 'info' && s.status !== 'done').length;
}

/** Puesta en marcha de los despachos: el propio para el rol B, todos para el rol A. */
@Injectable({ providedIn: 'root' })
export class OfficeSetupService {
  private api = inject(ApiClientService);

  /** Puesta en marcha del propio despacho (rol B), compartida por Ajustes y el menú de cuenta. */
  readonly own = signal<OfficeCompletenessDetail | null>(null);
  readonly ownPending = computed(() => pendingOfficeSteps(this.own()?.officeSteps ?? []));

  /** Es una ayuda: si falla se queda como estaba y no se avisa al usuario. */
  async loadOwn(): Promise<void> {
    try {
      this.own.set(await this.getOwn());
    } catch (error) {
      console.error('Error cargando la puesta en marcha del despacho', error);
    }
  }

  getOwn(): Promise<OfficeCompletenessDetail> {
    return this.api.get<OfficeCompletenessDetail>('/completeness/office');
  }
  listOffices(): Promise<CompletenessOverview> {
    return this.api.get<CompletenessOverview>('/completeness/offices');
  }
  getOffice(administratorId: string): Promise<OfficeCompletenessDetail> {
    return this.api.get<OfficeCompletenessDetail>(`/completeness/offices/${administratorId}`);
  }
}
