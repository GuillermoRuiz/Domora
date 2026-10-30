export type SupplierVisitStatus = 'planificada' | 'realizada' | 'cancelada';

/** Estado de contrato tal y como lo deriva el backend. */
export type PanelContractStatus = 'Activo' | 'PorVencer' | 'Vencido' | 'Cancelado';

/** Lo que se muestra del proveedor: `baja` manda; si no, el estado de su contrato más urgente. */
export type SupplierDisplayStatus = 'activo' | 'renovar' | 'vencido' | 'baja';

/** Una visita de un proveedor a la finca (`GET estates/:id/suppliers/:supplierId/visits`). */
export interface SupplierVisit {
  id: string;
  supplierId: string;
  estateId: string;
  /** Fecha y hora (ISO 8601). */
  scheduledAt: string;
  purpose: string;
  status: SupplierVisitStatus;
  notes: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  asset: { id: string; name: string } | null;
  issue: { id: string; ref: string; title: string } | null;
}

/** Alta y edición de una visita (en edición, `null` borra un campo opcional). */
export interface SupplierVisitInput {
  scheduledAt: string;
  purpose: string;
  notes?: string | null;
  assetId?: string | null;
  issueId?: string | null;
}

export interface SupplierPanelContract {
  id: string;
  serviceType: string;
  status: PanelContractStatus;
  /** ISO 8601, o null si es indefinido. */
  endDate: string | null;
  /** Negativo si ya venció. */
  daysLeft: number | null;
}

/** Una fila del panel de Proveedores. */
export interface SupplierPanelRow {
  id: string;
  name: string;
  category: string;
  status: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  displayStatus: SupplierDisplayStatus;
  contract: SupplierPanelContract | null;
  nextVisit: { id: string; scheduledAt: string; purpose: string } | null;
  /** Incidencias abiertas con este proveedor asignado. */
  openIssues: number;
}

export interface SupplierIntervention {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCategory: string;
  purpose: string;
  scheduledAt: string;
  completedAt: string | null;
  notes: string | null;
  asset: { id: string; name: string } | null;
  issue: { id: string; ref: string; title: string } | null;
}

export interface SupplierPanelKpis {
  totalSuppliers: number;
  activeContracts: number;
  expiringContracts: number;
  openIssues: number;
}

/** `GET estates/:id/suppliers/overview`. */
export interface SupplierPanelOverview {
  kpis: SupplierPanelKpis;
  items: SupplierPanelRow[];
  recentInterventions: SupplierIntervention[];
}

export type SupplierTone = 'positive' | 'warning' | 'danger' | 'info' | 'neutral';

export const SUPPLIER_STATUS: Record<SupplierDisplayStatus, { text: string; tone: SupplierTone }> = {
  activo: { text: 'Activo', tone: 'positive' },
  renovar: { text: 'Renovar contrato', tone: 'warning' },
  vencido: { text: 'Contrato vencido', tone: 'danger' },
  baja: { text: 'De baja', tone: 'neutral' },
};

/** Texto de la columna "Contrato": "Vence en 3 meses", "Venció hace 25 días", "Indefinido"; "Sin contrato" si no hay. */
export function contractDeadlineLabel(contract: SupplierPanelContract | null): string {
  if (!contract) return 'Sin contrato';
  const days = contract.daysLeft;
  if (days === null) return 'Indefinido';
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (days === 0) return 'Vence hoy';
  if (days < 0) {
    const ago = -days;
    return `Venció hace ${ago <= 60 ? unit(ago, 'día', 'días') : unit(Math.round(ago / 30), 'mes', 'meses')}`;
  }
  return `Vence en ${days <= 60 ? unit(days, 'día', 'días') : unit(Math.round(days / 30), 'mes', 'meses')}`;
}

const VISIT_DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
const VISIT_TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/** "03 nov 2026" en la hora local del navegador; "—" si no hay fecha. */
export const visitDate = (iso: string | null): string => (iso ? VISIT_DATE.format(new Date(iso)) : '—');
/** "09:30" en la hora local del navegador. */
export const visitTime = (iso: string): string => VISIT_TIME.format(new Date(iso));
