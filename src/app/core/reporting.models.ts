export type ReportFormat = 'pdf' | 'xlsx';
export type ReportSensitivity = 'internal' | 'personal_data' | 'financial' | 'tax';
export interface ReportDefinition {
  key: string; category: string; title: string; description: string; icon: string;
  scopeMode: 'single' | 'multiple';
  periodMode: 'none' | 'range' | 'comparison' | 'year' | 'asOf' | 'quarter';
  formats: ReportFormat[]; status: 'available' | 'disabled'; sensitivity: ReportSensitivity;
  filters: ('accountCode' | 'propertyId' | 'supplierId' | 'receiptKind' | 'assignmentMode' | 'spendBasis' | 'days')[];
}
export interface ReportCategory { key: string; title: string; description: string; icon: string; }
export interface ReportCatalog { categories: ReportCategory[]; reports: ReportDefinition[]; }
export interface ReportEstate { id: string; name: string; address?: string; streetNumber?: string | null; location?: string; }
export interface ReportScopeSelection { scopeMode: 'all' | 'selected'; estateIds: string[]; }
export interface ReportFilters {
  accountCode?: string; propertyId?: string; supplierId?: string; receiptKind?: string;
  assignmentMode?: 'current' | 'history'; spendBasis?: 'invoiced' | 'accrued' | 'paid'; days?: number;
}
export interface ReportInput {
  scopeMode: 'all' | 'selected'; estateIds?: string[];
  from?: string; to?: string; asOf?: string; fiscalYear?: number; quarter?: number;
  compareFrom?: string; compareTo?: string; filters?: ReportFilters;
}
export interface ReportingSection {
  title?: string;
  columns: { key: string; header: string; kind?: 'text' | 'money' | 'int'; width?: number }[];
  rows: Record<string, string | number | null | undefined>[];
  totals?: Record<string, string | number | null | undefined>; empty?: string;
}
export interface ReportResult {
  metadata: {
    reportKey: string; title: string; generatedAt: string; snapshotId?: string; snapshotExpiresAt?: string;
    scope: { mode: 'all' | 'selected'; estates: ReportEstate[] };
    period: Pick<ReportInput, 'from' | 'to' | 'asOf' | 'fiscalYear' | 'quarter' | 'compareFrom' | 'compareTo'>;
    currency: 'EUR'; warnings: string[]; sensitivity: ReportSensitivity;
  };
  summary: { label: string; value: string | number; format: 'money' | 'number' | 'text' }[];
  sections: ReportingSection[]; rowCount: number;
}
