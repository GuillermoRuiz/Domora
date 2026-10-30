import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { EstateCashflow, EstateDashboardSummary, EstateActivity, EstateExpenseBreakdown, EstateMilestones, EstatePropertyStatuses, EstateRecentProperties } from './estate-dashboard.models';

/** Datos agregados del panel de la finca (rol A/B). */
@Injectable({ providedIn: 'root' })
export class EstateDashboardService {
  private api = inject(ApiClientService);

  getSummary(estateId: string): Promise<EstateDashboardSummary> {
    return this.api.get<EstateDashboardSummary>(`/estates/${estateId}/dashboard/summary`);
  }

  /** Ingresos y gastos por mes; sin `year`, el ejercicio en curso. */
  getCashflow(estateId: string, year?: number): Promise<EstateCashflow> {
    return this.api.get<EstateCashflow>(`/estates/${estateId}/dashboard/cashflow`, year === undefined ? undefined : { year });
  }

  /** Gastos del ejercicio por categoría; sin `year`, el ejercicio en curso. */
  getExpenseBreakdown(estateId: string, year?: number): Promise<EstateExpenseBreakdown> {
    return this.api.get<EstateExpenseBreakdown>(`/estates/${estateId}/dashboard/expense-breakdown`, year === undefined ? undefined : { year });
  }

  /** Próximos hitos (juntas, inspecciones, vencimientos de contrato), vencidos primero. */
  getMilestones(estateId: string): Promise<EstateMilestones> {
    return this.api.get<EstateMilestones>(`/estates/${estateId}/dashboard/milestones`);
  }

  /** Lo último que ha pasado en la finca; sin `limit`, las 8 más recientes. `subjects` limita a ciertos tipos de actividad. */
  getActivity(estateId: string, limit?: number, subjects?: string[]): Promise<EstateActivity> {
    const params: Record<string, string | number> = {};
    if (limit !== undefined) params['limit'] = limit;
    if (subjects && subjects.length > 0) params['subjects'] = subjects.join(',');
    return this.api.get<EstateActivity>(`/estates/${estateId}/dashboard/activity`, Object.keys(params).length > 0 ? params : undefined);
  }

  /** Las últimas propiedades dadas de alta, con titular, saldo y estado; sin `limit`, 5. */
  getRecentProperties(estateId: string, limit?: number): Promise<EstateRecentProperties> {
    return this.api.get<EstateRecentProperties>(`/estates/${estateId}/dashboard/properties`, limit === undefined ? undefined : { limit });
  }

  /** Saldo, incidencias y estado de pago de todas las propiedades de la finca. */
  getPropertyStatuses(estateId: string): Promise<EstatePropertyStatuses> {
    return this.api.get<EstatePropertyStatuses>(`/estates/${estateId}/dashboard/property-statuses`);
  }
}
