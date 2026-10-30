import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';

export interface ReportEstateHeader {
  name: string;
  cif: string | null;
}

export interface TrialBalanceReport {
  estate: ReportEstateHeader;
  fiscalYear: number;
  rows: { code: string; name: string; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
}

export interface GeneralLedgerRow {
  date: string;
  entryNumber: string;
  concept: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface GeneralLedgerReport {
  estate: ReportEstateHeader;
  account: { code: string; name: string };
  from: string | null;
  to: string | null;
  openingBalance: number;
  closingBalance: number;
  rows: GeneralLedgerRow[];
}

export interface PropertyStatementReport extends GeneralLedgerReport {
  property: { id: string; ref: string };
}

export interface BalanceSheetGroup {
  rows: { code: string; name: string; amount: number }[];
  total: number;
}

export interface BalanceSheetReport {
  estate: ReportEstateHeader;
  asOf: string;
  asset: BalanceSheetGroup;
  liability: BalanceSheetGroup;
  equity: BalanceSheetGroup;
  balanced: boolean;
}

export interface BudgetVsActualReport {
  estate: ReportEstateHeader;
  fiscalYear: number;
  rows: { code: string; name: string; budgeted: number; executed: number; deviation: number }[];
  totalBudgeted: number;
  totalExecuted: number;
}

export interface CashSettlementGroup {
  rows: { code: string; name: string; amount: number }[];
  total: number;
}

export interface CashSettlementReport {
  estate: ReportEstateHeader;
  from: string;
  to: string;
  income: CashSettlementGroup;
  expense: CashSettlementGroup;
  net: number;
}

export type EstateReportKind = 'trial-balance' | 'general-ledger' | 'balance-sheet' | 'budget-vs-actual' | 'cash-settlement';

/**
 * Informes contables de fase 12 (doc/contabilidad/roadmap-partida-doble.md):
 * sumas y saldos, mayor, balance de situación, resultados frente a
 * presupuesto y liquidación por criterio de caja. El extracto por propiedad
 * (`ledger-extract`) es el mismo mayor filtrado a la 430 de una propiedad,
 * accesible también al rol C — ver `LedgerReportsService.propertyStatement`
 * en el backend.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private api = inject(ApiClientService);

  trialBalance(estateId: string, fiscalYear: number): Promise<TrialBalanceReport> {
    return this.api.get<TrialBalanceReport>(`/estates/${estateId}/reports/trial-balance`, { fiscalYear });
  }

  generalLedger(estateId: string, query: {
    accountCode: string;
    propertyId?: string;
    supplierId?: string;
    from?: string;
    to?: string;
  }): Promise<GeneralLedgerReport> {
    return this.api.get<GeneralLedgerReport>(`/estates/${estateId}/reports/general-ledger`, query);
  }

  balanceSheet(estateId: string, asOf?: string): Promise<BalanceSheetReport> {
    return this.api.get<BalanceSheetReport>(`/estates/${estateId}/reports/balance-sheet`, { asOf });
  }

  budgetVsActual(estateId: string, fiscalYear: number): Promise<BudgetVsActualReport> {
    return this.api.get<BudgetVsActualReport>(`/estates/${estateId}/reports/budget-vs-actual`, { fiscalYear });
  }

  cashSettlement(estateId: string, from: string, to: string): Promise<CashSettlementReport> {
    return this.api.get<CashSettlementReport>(`/estates/${estateId}/reports/cash-settlement`, { from, to });
  }

  /** El extracto de un propietario — también lo puede pedir el propio rol C, de SU propiedad. */
  propertyStatement(propertyId: string, query: { from?: string; to?: string } = {}): Promise<PropertyStatementReport> {
    return this.api.get<PropertyStatementReport>(`/properties/${propertyId}/ledger-extract`, query);
  }

  /** Excel o PDF de cualquiera de los informes por finca — mismo endpoint que la pantalla, con format=xlsx|pdf. */
  download(
    estateId: string,
    report: EstateReportKind,
    format: 'xlsx' | 'pdf',
    query: Record<string, string | number | undefined> = {},
  ): Promise<Blob> {
    const params = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    return this.api.getBlob(`/estates/${estateId}/reports/${report}?${params.toString()}`);
  }

  downloadPropertyStatement(propertyId: string, format: 'xlsx' | 'pdf', query: { from?: string; to?: string } = {}): Promise<Blob> {
    const params = new URLSearchParams({ format });
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return this.api.getBlob(`/properties/${propertyId}/ledger-extract?${params.toString()}`);
  }
}
