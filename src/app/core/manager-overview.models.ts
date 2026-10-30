/** Respuestas de `/manager-overview/*` (vista general del gestor, rol B). Euros con decimales. */

/** Variación frente a hace 6 meses: «nuevo» si antes no había nada y ahora sí; si no, un porcentaje. */
export type KpiChange = { type: 'new' } | { type: 'percent'; value: number };

export interface KpiCard {
  value: number;
  previous: number;
  change: KpiChange;
}

export interface ManagerKpis {
  /** `null` = todas las comunidades del gestor. */
  estateId: string | null;
  generatedAt: string;
  estates: KpiCard;
  activeIssues: KpiCard;
  pendingDues: KpiCard;
  pendingRequests: KpiCard;
  upcomingMeetings: KpiCard;
}

export type PendingUrgency = 'urgente' | 'hoy' | 'esta_semana';
export type PendingKind = 'receipt' | 'installation' | 'inspection' | 'contract' | 'adhesion';

export interface PendingItem {
  id: string;
  kind: PendingKind;
  urgency: PendingUrgency;
  title: string;
  detail: string;
  estateId: string;
  estateName: string;
  date: string | null;
  amount: number | null;
  safety: boolean;
  target: { section: 'cuotas' | 'instalaciones' | 'proveedores' | 'solicitudes'; estateId: string; refId: string | null };
}

export interface PendingToday {
  /** Todos los pendientes: es el número de la cabecera aunque solo viajen algunas filas. */
  total: number;
  items: PendingItem[];
}

export type MilestoneKind = 'meeting' | 'inspection' | 'contract';

export interface MilestoneItem {
  id: string;
  kind: MilestoneKind;
  title: string;
  estateId: string;
  estateName: string;
  /** Junta: instante ISO; revisión y contrato: AAAA-MM-DD. */
  date: string;
  target: { section: 'juntas' | 'instalaciones' | 'proveedores'; estateId: string; refId: string };
}

export interface ManagerMilestones {
  items: MilestoneItem[];
}

export interface EconomicSummary {
  estateId: string | null;
  fiscalYear: number | null;
  billed: number;
  collected: number;
  pending: number;
  treasury: number;
  reserve: number;
  expenses: number;
}

export type ActivitySubjectType =
  | 'issue' | 'receipt' | 'communication' | 'document' | 'membership'
  | 'regulatory_inspection' | 'meeting' | 'property' | 'fiscal_year' | 'supplier' | 'message';

export interface ManagerActivityItem {
  id: string;
  subjectType: ActivitySubjectType;
  verb: string;
  summary: string;
  occurredAt: string;
  estateId: string | null;
  estateName: string | null;
}

export interface ManagerActivity {
  items: ManagerActivityItem[];
}

export type PerformanceStatus = 'al_dia' | 'con_incidencias';

export interface PerformanceRow {
  rank: number;
  estateId: string;
  name: string;
  color: string | null;
  billed: number;
  incidents: number;
  status: PerformanceStatus;
}

export interface PerformanceRanking {
  items: PerformanceRow[];
  /** La finca elegida si no está entre las 10, con su posición real. */
  selected: PerformanceRow | null;
  total: number;
}
