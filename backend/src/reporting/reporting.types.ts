import type { AuthenticatedUser } from '../auth/auth.types';
import type { ReportSection } from '../common/reports/table-report';

export type ReportFormat = 'pdf' | 'xlsx';
export type ReportSensitivity =
  'internal' | 'personal_data' | 'financial' | 'tax';
export interface ReportDefinition {
  key: string;
  category: string;
  title: string;
  description: string;
  icon: string;
  scopeMode: 'single' | 'multiple';
  periodMode: 'none' | 'range' | 'comparison' | 'year' | 'asOf' | 'quarter';
  formats: ReportFormat[];
  status: 'available' | 'disabled';
  sensitivity: ReportSensitivity;
  filters: (
    | 'accountCode'
    | 'propertyId'
    | 'supplierId'
    | 'receiptKind'
    | 'assignmentMode'
    | 'spendBasis'
    | 'days'
  )[];
}
export interface ReportEstate {
  id: string;
  name: string;
}
export interface ReportScope {
  administratorId: string;
  user: AuthenticatedUser;
  estates: ReportEstate[];
  estateIds: string[];
  mode: 'all' | 'selected';
}
export interface ReportFilters {
  accountCode?: string;
  propertyId?: string;
  supplierId?: string;
  receiptKind?: string;
  assignmentMode?: 'current' | 'history';
  spendBasis?: 'invoiced' | 'accrued' | 'paid';
  days?: number;
}
export interface ReportInput {
  scopeMode: 'all' | 'selected';
  estateIds?: string[];
  from?: string;
  to?: string;
  asOf?: string;
  fiscalYear?: number;
  quarter?: number;
  compareFrom?: string;
  compareTo?: string;
  filters?: ReportFilters;
}
export interface ReportSummary {
  label: string;
  value: number | string;
  format: 'money' | 'number' | 'text';
}
export interface ReportData {
  sections: ReportSection[];
  summary?: ReportSummary[];
  warnings?: string[];
}
export interface ReportResult {
  metadata: {
    reportKey: string;
    title: string;
    generatedAt: string;
    snapshotId?: string;
    snapshotExpiresAt?: string;
    scope: { mode: 'all' | 'selected'; estates: ReportEstate[] };
    period: {
      from?: string;
      to?: string;
      asOf?: string;
      fiscalYear?: number;
      quarter?: number;
      compareFrom?: string;
      compareTo?: string;
    };
    currency: 'EUR';
    warnings: string[];
    sensitivity: ReportSensitivity;
  };
  summary: ReportSummary[];
  sections: ReportSection[];
  rowCount: number;
}
