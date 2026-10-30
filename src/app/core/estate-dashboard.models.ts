/** Respuesta de `GET /estates/:id/dashboard/summary` (importes en euros). */
export interface EstateDashboardSummary {
  estateId: string;
  units: number;
  /** Dinero en bancos y caja según el diario. */
  balance: number;
  pendingDues: { amount: number; properties: number };
  issues: { open: number; thisYear: number };
  nextMeeting: {
    id: string;
    title: string;
    type: 'ordinaria' | 'extraordinaria';
    /** ISO 8601. */
    scheduledAt: string;
  } | null;
}

/** Respuesta de `GET /estates/:id/dashboard/cashflow?year=` (importes en euros). */
export interface EstateCashflow {
  year: number;
  /** Ejercicios para el selector (con movimientos + el actual). */
  years: number[];
  /** Siempre 12 filas; los meses sin movimientos vienen a 0. */
  months: { month: number; income: number; expenses: number }[];
}

export type ExpenseCategoryKey = 'maintenance' | 'supplies' | 'staff' | 'insurance' | 'services' | 'other';

/** Respuesta de `GET /estates/:id/dashboard/expense-breakdown?year=` (importes en euros, de mayor a menor, sin categorías vacías). */
export interface EstateExpenseBreakdown {
  year: number;
  total: number;
  categories: { key: ExpenseCategoryKey; label: string; amount: number }[];
}

export type MilestoneKind = 'meeting' | 'inspection' | 'contract';

/** Un hito de `GET /estates/:id/dashboard/milestones`. `date` es `YYYY-MM-DD` (inspecciones y contratos) o ISO con hora (juntas). */
export interface EstateMilestone {
  key: string;
  kind: MilestoneKind;
  title: string;
  date: string;
  overdue: boolean;
}

export interface EstateMilestones {
  items: EstateMilestone[];
}

export type ActivitySubjectType =
  | 'issue' | 'receipt' | 'communication' | 'document'
  | 'membership' | 'regulatory_inspection' | 'meeting' | 'property' | 'fiscal_year';

/** Una entrada de `GET /estates/:id/dashboard/activity` (la más reciente primero). */
export interface EstateActivityItem {
  id: string;
  verb: string;
  subjectType: ActivitySubjectType;
  summary: string;
  /** ISO 8601. */
  occurredAt: string;
  actorName: string | null;
  propertyRef: string | null;
}

export interface EstateActivity {
  items: EstateActivityItem[];
}

export type RecentPropertyStatus = 'ok' | 'overdue';

/** Respuesta de `GET /estates/:id/dashboard/properties?limit=` (importes en euros). */
export interface EstateRecentProperties {
  /** Propiedades de la finca (para "Ver todas (N)"). */
  total: number;
  items: {
    id: string;
    ref: string | null;
    type: string;
    titular: string | null;
    quotaMonthly: number;
    /** Lo que debe, en positivo. */
    balance: number;
    status: RecentPropertyStatus;
  }[];
}

/** Respuesta de `GET /estates/:id/dashboard/property-statuses`: una entrada por propiedad de la finca. */
export interface EstatePropertyStatuses {
  items: {
    propertyId: string;
    /** Lo que debe, en positivo. */
    balance: number;
    status: RecentPropertyStatus;
    /** Fecha (AAAA-MM-DD) del último cobro no deshecho; null si nunca ha pagado. */
    lastPaymentDate: string | null;
    /** Desde cuándo tiene titular con cuenta (AAAA-MM-DD); null si no lo tiene. */
    ownerSince: string | null;
  }[];
}
