import type { Administrator, ClientCommercialRow, ClientStatus, Lead, LeadOrigin, LeadStatus, OfficeHealth, PlanTier } from '../../core/models';
import type { BadgeVariant } from '../admin-detail-a/admin-labels';

/**
 * Rows, filters and sorting of the Clientes screen (odd/tasks/role-a-panel.md
 * S13). One row = one despacho of `GET /admins` (the same record as
 * Administradores de fincas) joined with its salud and commercial data.
 */

export interface ClientRow {
  admin: Administrator;
  /** Missing when `/client-health/offices` failed. */
  health?: OfficeHealth;
  /** Missing when `/clients/overview` failed. */
  commercial?: ClientCommercialRow;
}

export type SignupWindow = 'all' | '30' | '90' | '365';
export type SortKey = 'name' | 'mrr' | 'salud' | 'signupAt' | 'nextRenewal' | 'nextAction';
export type SortDir = 'asc' | 'desc';

export interface ClientFilters {
  query: string;
  status: ClientStatus | 'TODOS';
  plan: PlanTier | 'TODOS';
  signup: SignupWindow;
}

export const SIGNUP_WINDOWS: { value: SignupWindow; label: string }[] = [
  { value: 'all', label: 'Cualquier fecha' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
  { value: '365', label: 'Último año' },
];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Cliente' },
  { value: 'mrr', label: 'MRR' },
  { value: 'salud', label: 'Salud' },
  { value: 'signupAt', label: 'Fecha de alta' },
  { value: 'nextRenewal', label: 'Próxima renovación' },
  { value: 'nextAction', label: 'Próxima acción' },
];

export type OptionalColumn = 'signupAt' | 'nextRenewal' | 'lastActivity';

export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: 'signupAt', label: 'Fecha de alta' },
  { key: 'nextRenewal', label: 'Próxima renovación' },
  { key: 'lastActivity', label: 'Última actividad' },
];

export const LEAD_ORIGIN_LABEL: Record<LeadOrigin, string> = {
  web: 'Web',
  referido: 'Referido',
  comercial: 'Comercial',
  solicitud_alta: 'Solicitud de alta de comunidad',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_prueba: 'En prueba',
  convertido: 'Convertido',
  descartado: 'Descartado',
};

export function leadStatusVariant(status: LeadStatus): BadgeVariant {
  if (status === 'nuevo') return 'primary';
  if (status === 'contactado' || status === 'en_prueba') return 'warning';
  if (status === 'convertido') return 'green';
  return 'default';
}

/** Leads still to be worked: they show in «Nuevas oportunidades». */
export function isOpenLead(lead: Lead): boolean {
  return lead.status === 'nuevo' || lead.status === 'contactado' || lead.status === 'en_prueba';
}

export function buildClientRows(
  admins: Administrator[],
  health: Map<string, OfficeHealth>,
  commercial: Map<string, ClientCommercialRow>,
): ClientRow[] {
  return admins.map(admin => ({ admin, health: health.get(admin.id), commercial: commercial.get(admin.id) }));
}

const DAY_MS = 86_400_000;

export function filterClients(rows: ClientRow[], f: ClientFilters, today: Date): ClientRow[] {
  const q = f.query.trim().toLowerCase();
  const since = f.signup === 'all' ? null : new Date(today.getTime() - Number(f.signup) * DAY_MS).toISOString().slice(0, 10);
  return rows.filter(({ admin, commercial }) => {
    if (q && ![admin.name, admin.cif, admin.contactName, admin.contactEmail].some(v => (v ?? '').toLowerCase().includes(q))) return false;
    if (f.status !== 'TODOS' && admin.clientStatus !== f.status) return false;
    if (f.plan !== 'TODOS' && admin.plan !== f.plan) return false;
    if (since && (!commercial || commercial.signupAt < since)) return false;
    return true;
  });
}

function sortValue(row: ClientRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name': return row.admin.name;
    case 'mrr': return row.admin.mrr;
    case 'salud': return row.health?.salud ?? null;
    case 'signupAt': return row.commercial?.signupAt ?? null;
    case 'nextRenewal': return row.commercial?.nextRenewal?.date ?? null;
    case 'nextAction': return row.commercial?.nextActionAt ?? null;
  }
}

/** Empty values always go last, in both directions. */
export function sortClients(rows: ClientRow[], key: SortKey, dir: SortDir): ClientRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.admin.name.localeCompare(b.admin.name, 'es');
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
    return cmp * sign || a.admin.name.localeCompare(b.admin.name, 'es');
  });
}

/** «Clientes en riesgo»: lowest salud first. */
export function riskClients(rows: ClientRow[]): ClientRow[] {
  return rows
    .filter(r => r.health?.atRisk)
    .sort((a, b) => (a.health!.salud ?? 0) - (b.health!.salud ?? 0) || a.admin.name.localeCompare(b.admin.name, 'es'));
}

/** «26 oct 2026» for dates sent as YYYY-MM-DD. */
export function fmtDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
