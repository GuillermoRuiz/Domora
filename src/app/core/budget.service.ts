import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { BudgetItem, CostCentreBudget, BudgetAnalysis } from './models';

/**
 * Presupuesto por cuenta y por centro de coste, y análisis año actual frente
 * al anterior. Lo ejecutado lo calcula el backend desde el diario.
 */
@Injectable({ providedIn: 'root' })
export class BudgetService {
  private api = inject(ApiClientService);

  // ── Budget (por cuenta contable) ────────────────────────────────────────
  async listBudget(estateId: string, fiscalYear?: number): Promise<BudgetItem[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/budget`, { fiscalYear });
    return rows.map((i: any): BudgetItem => ({
      id: i.id,
      accountId: i.accountId,
      code: i.accountCode,
      category: i.category,
      fiscalYear: i.fiscalYear,
      budgeted: Number(i.budgeted ?? 0),
      executed: Number(i.executed ?? 0),
      ...(i.executedPriorYear !== undefined && { executedPriorYear: Number(i.executedPriorYear) }),
    }));
  }

  async upsertBudgetItem(estateId: string, item: { accountCode: string; category: string; fiscalYear: number; budgeted: number }): Promise<void> {
    await this.api.post(`/estates/${estateId}/budget`, item);
  }

  // ── Budget (por centro de coste) ────────────────────────────────────────
  async listCostCentreBudget(estateId: string, fiscalYear?: number): Promise<CostCentreBudget[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/cost-centre-budget`, { fiscalYear });
    return rows.map((i: any): CostCentreBudget => ({
      id: i.id,
      costCentreId: i.costCentreId,
      costCentreName: i.costCentreName,
      fiscalYear: i.fiscalYear,
      budgeted: Number(i.budgeted ?? 0),
      executed: Number(i.executed ?? 0),
      ...(i.executedPriorYear !== undefined && { executedPriorYear: Number(i.executedPriorYear) }),
    }));
  }

  async upsertCostCentreBudget(estateId: string, item: { costCentreId: string; fiscalYear: number; budgeted: number }): Promise<void> {
    await this.api.post(`/estates/${estateId}/cost-centre-budget`, item);
  }

  // ── Análisis (año actual vs. anterior + reserva legal) ──────────────────
  async getAnalysis(estateId: string, fiscalYear?: number): Promise<BudgetAnalysis> {
    const raw = await this.api.get<any>(`/estates/${estateId}/budget/analysis`, { fiscalYear });
    return {
      fiscalYear: raw.fiscalYear,
      budget: raw.budget.map((i: any): BudgetItem => ({
        id: i.id,
        accountId: i.accountId,
        code: i.accountCode,
        category: i.category,
        fiscalYear: i.fiscalYear,
        budgeted: Number(i.budgeted ?? 0),
        executed: Number(i.executed ?? 0),
        executedPriorYear: Number(i.executedPriorYear ?? 0),
      })),
      costCentreBudget: raw.costCentreBudget.map((i: any): CostCentreBudget => ({
        id: i.id,
        costCentreId: i.costCentreId,
        costCentreName: i.costCentreName,
        fiscalYear: i.fiscalYear,
        budgeted: Number(i.budgeted ?? 0),
        executed: Number(i.executed ?? 0),
        executedPriorYear: Number(i.executedPriorYear ?? 0),
      })),
      reserveLegalMinimum: raw.reserveLegalMinimum !== null ? Number(raw.reserveLegalMinimum) : null,
    };
  }
}
