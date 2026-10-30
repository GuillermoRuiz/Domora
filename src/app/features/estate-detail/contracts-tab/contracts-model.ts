import type { EstateContract, SupplierContractStatus } from '../../../core/models';
import { ESTATE_COLOR_PALETTE } from '../../../core/estates.service';

/**
 * Reglas del panel «Contratos» de la ficha de finca, como funciones puras (sin Angular) para poder
 * probarlas a fondo. Decisiones del plan `odd/tasks/contratos-panel-c.md` (D4–D11).
 */

/** Ventana de «Vencen pronto» y de la columna Alerta en ESTE panel (D4). El estado «Por vencer» sigue en 30 días. */
export const ALERT_DAYS = 90;

export type AlertTone = 'danger' | 'warning' | 'neutral';

export interface ContractAlert {
  text: string;
  tone: AlertTone;
}

/** Contratos «vigentes»: los activos y los que vencen en 30 días. */
export const isCurrent = (c: Pick<EstateContract, 'status'>): boolean => c.status === 'Activo' || c.status === 'PorVencer';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «N días» hasta 60; después meses y, desde el año, años (se redondea). */
export function durationText(days: number): string {
  if (days <= 60) return plural(days, 'día', 'días');
  if (days < 365) return plural(Math.max(2, Math.round(days / 30.44)), 'mes', 'meses');
  return plural(Math.round(days / 365), 'año', 'años');
}

/**
 * Texto y color de la columna Alerta (D4): vencido → rojo; ≤30 días → rojo; 31–90 → ámbar; más lejos →
 * neutro. Sin fecha de fin → «Sin vencimiento»; cancelado → «Cancelado»; programado → cuándo empieza.
 */
export function contractAlert(c: Pick<EstateContract, 'status' | 'daysLeft' | 'startDate' | 'cancelledAt'>, now: Date = new Date()): ContractAlert {
  if (c.status === 'Cancelado') return { text: c.cancelledAt ? `Cancelado el ${formatDate(c.cancelledAt)}` : 'Cancelado', tone: 'neutral' };
  if (c.status === 'Programado') {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.max(0, Math.round((new Date(`${c.startDate}T00:00:00Z`).getTime() - today) / 86_400_000));
    return { text: days === 0 ? 'Empieza hoy' : `Empieza en ${durationText(days)}`, tone: 'neutral' };
  }
  const days = c.daysLeft;
  if (days === null || days === undefined) return { text: 'Sin vencimiento', tone: 'neutral' };
  if (days < 0) return { text: `Vencido hace ${durationText(-days)}`, tone: 'danger' };
  if (days === 0) return { text: 'Vence hoy', tone: 'danger' };
  const text = `Vence en ${durationText(days)}`;
  return { text, tone: days <= 30 ? 'danger' : days <= ALERT_DAYS ? 'warning' : 'neutral' };
}

// ── Fichas ─────────────────────────────────────────────────────────────

export interface ContractKpis {
  /** Activos + por vencer. */
  active: number;
  /** Todos los contratos registrados (también vencidos y cancelados). */
  total: number;
  /** Vigentes que vencen en los próximos `ALERT_DAYS` días. */
  expiringSoon: number;
  /** Contratos ya vencidos (sin cancelar). */
  expired: number;
  /** Vigentes con renovación tácita. */
  autoRenewals: number;
  /** Suma anualizada (euros) de los vigentes con coste anual en euros. */
  annualAmount: number;
  /** Vigentes que no se pueden anualizar (puntual, «otro» o sin importe). */
  withoutAnnual: number;
  /** Vigentes con importe en otra moneda: no se suman. */
  otherCurrency: number;
}

export function contractKpis(contracts: EstateContract[]): ContractKpis {
  const current = contracts.filter(isCurrent);
  let annualAmount = 0;
  let withoutAnnual = 0;
  let otherCurrency = 0;
  for (const c of current) {
    if (c.annualCost == null) withoutAnnual += 1;
    else if ((c.currency ?? 'EUR') !== 'EUR') otherCurrency += 1;
    else annualAmount += c.annualCost;
  }
  return {
    active: current.length,
    total: contracts.length,
    expiringSoon: current.filter((c) => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= ALERT_DAYS).length,
    expired: contracts.filter((c) => c.status === 'Vencido').length,
    autoRenewals: current.filter((c) => c.renewalType === 'tacita').length,
    annualAmount: Math.round(annualAmount * 100) / 100,
    withoutAnnual,
    otherCurrency,
  };
}

// ── Filtros, orden y URL ───────────────────────────────────────────────

export type Vigencia = 'todos' | 'activos' | 'por_vencer' | 'vencidos' | 'programados' | 'cancelados';
export type ContractSort = 'vencimiento_asc' | 'vencimiento_desc' | 'importe_desc' | 'proveedor' | 'inicio_desc';
export type RenewalFilter = '' | 'tacita' | 'manual';

export interface ContractFilters {
  search: string;
  vigencia: Vigencia;
  supplierId: string;
  renewal: RenewalFilter;
  category: string;
  /** Rango sobre el vencimiento (AAAA-MM-DD, extremos incluidos); '' = sin límite. */
  from: string;
  to: string;
  sort: ContractSort;
}

export const DEFAULT_FILTERS: ContractFilters = {
  search: '', vigencia: 'todos', supplierId: '', renewal: '', category: '', from: '', to: '', sort: 'vencimiento_asc',
};

export const VIGENCIAS: { id: Vigencia; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'activos', label: 'Activos' },
  { id: 'por_vencer', label: 'Por vencer' },
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'programados', label: 'Programados' },
  { id: 'cancelados', label: 'Cancelados' },
];

export const SORTS: { id: ContractSort; label: string }[] = [
  { id: 'vencimiento_asc', label: 'Vencimiento (más próximo)' },
  { id: 'vencimiento_desc', label: 'Vencimiento (más lejano)' },
  { id: 'importe_desc', label: 'Importe anual (mayor)' },
  { id: 'proveedor', label: 'Proveedor (A-Z)' },
  { id: 'inicio_desc', label: 'Inicio (más reciente)' },
];

/** Minúsculas y sin acentos, para buscar sin preocuparse de ellos. */
export const normalizeText = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const STATUS_BY_VIGENCIA: Record<Exclude<Vigencia, 'todos' | 'activos'>, SupplierContractStatus> = {
  por_vencer: 'PorVencer', vencidos: 'Vencido', programados: 'Programado', cancelados: 'Cancelado',
};

export function matchesVigencia(c: Pick<EstateContract, 'status'>, vigencia: Vigencia): boolean {
  if (vigencia === 'todos') return true;
  if (vigencia === 'activos') return isCurrent(c);
  return c.status === STATUS_BY_VIGENCIA[vigencia];
}

export function filterContracts(contracts: EstateContract[], f: ContractFilters): EstateContract[] {
  const query = normalizeText(f.search);
  return contracts.filter((c) => {
    if (!matchesVigencia(c, f.vigencia)) return false;
    if (f.supplierId && c.supplier.id !== f.supplierId) return false;
    if (f.renewal && c.renewalType !== f.renewal) return false;
    if (f.category && c.supplier.category !== f.category) return false;
    if (f.from || f.to) {
      // Con un rango, los contratos sin fecha de fin no entran.
      if (!c.endDate) return false;
      if (f.from && c.endDate < f.from) return false;
      if (f.to && c.endDate > f.to) return false;
    }
    if (query) {
      const haystack = normalizeText(`${c.serviceType} ${c.supplier.name} ${c.supplier.category}`);
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Ordena sin tocar la lista original. Los cancelados van SIEMPRE al final (D11); en el orden por
 * vencimiento los vencidos quedan arriba y los contratos sin fin después de los que tienen fecha.
 */
export function sortContracts(contracts: EstateContract[], sort: ContractSort): EstateContract[] {
  const rank = (c: EstateContract) => (c.status === 'Cancelado' ? 1 : 0);
  const byEnd = (a: EstateContract, b: EstateContract, dir: 1 | -1) => {
    if (!a.endDate && !b.endDate) return 0;
    if (!a.endDate) return 1;
    if (!b.endDate) return -1;
    return dir * a.endDate.localeCompare(b.endDate);
  };
  const compare: Record<ContractSort, (a: EstateContract, b: EstateContract) => number> = {
    vencimiento_asc: (a, b) => byEnd(a, b, 1),
    vencimiento_desc: (a, b) => byEnd(a, b, -1),
    importe_desc: (a, b) => (b.annualCost ?? -1) - (a.annualCost ?? -1),
    proveedor: (a, b) => a.supplier.name.localeCompare(b.supplier.name, 'es'),
    inicio_desc: (a, b) => b.startDate.localeCompare(a.startDate),
  };
  return [...contracts].sort((a, b) => rank(a) - rank(b) || compare[sort](a, b) || a.serviceType.localeCompare(b.serviceType, 'es') || a.id.localeCompare(b.id));
}

/** Próximos vencimientos: los 5 vigentes con fecha de fin más cercana (hoy o después). */
export function upcomingExpirations(contracts: EstateContract[], limit = 5): EstateContract[] {
  return contracts
    .filter((c) => isCurrent(c) && c.daysLeft != null && c.daysLeft >= 0)
    .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Opciones de los desplegables, a partir de los contratos reales de la finca. */
export function supplierOptions(contracts: EstateContract[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const c of contracts) seen.set(c.supplier.id, c.supplier.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
export function categoryOptions(contracts: EstateContract[]): string[] {
  return [...new Set(contracts.map((c) => c.supplier.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

// ── Estado en la URL (query params; `tab` lo gestiona la ficha) ────────

const PARAM_KEYS = { search: 'q', vigencia: 'vig', supplierId: 'prov', renewal: 'ren', category: 'cat', from: 'desde', to: 'hasta', sort: 'orden' } as const;
export const CONTRACT_QUERY_KEYS: string[] = Object.values(PARAM_KEYS);

const isOneOf = <T extends string>(value: string | null, options: readonly T[]): value is T => value !== null && (options as readonly string[]).includes(value);
const isDate = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Lee los filtros de la URL; lo que no sea válido vuelve al valor por defecto. */
export function filtersFromParams(get: (key: string) => string | null): ContractFilters {
  const vigencia = get(PARAM_KEYS.vigencia);
  const renewal = get(PARAM_KEYS.renewal);
  const sort = get(PARAM_KEYS.sort);
  const from = get(PARAM_KEYS.from);
  const to = get(PARAM_KEYS.to);
  return {
    search: get(PARAM_KEYS.search) ?? '',
    vigencia: isOneOf(vigencia, VIGENCIAS.map((v) => v.id)) ? vigencia : DEFAULT_FILTERS.vigencia,
    supplierId: get(PARAM_KEYS.supplierId) ?? '',
    renewal: isOneOf(renewal, ['tacita', 'manual'] as const) ? renewal : '',
    category: get(PARAM_KEYS.category) ?? '',
    from: isDate(from) ? from : '',
    to: isDate(to) ? to : '',
    sort: isOneOf(sort, SORTS.map((s) => s.id)) ? sort : DEFAULT_FILTERS.sort,
  };
}

/** Solo escribe lo que difiere del valor por defecto: una URL limpia y enlazable. Un valor vacío → `null` (se quita). */
export function filtersToParams(f: ContractFilters): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  (Object.keys(PARAM_KEYS) as (keyof typeof PARAM_KEYS)[]).forEach((key) => {
    const value = f[key];
    out[PARAM_KEYS[key]] = value === DEFAULT_FILTERS[key] || value === '' ? null : value;
  });
  return out;
}

// ── Atajos de las fichas (D9) ──────────────────────────────────────────

export type KpiShortcut = 'active' | 'expiring' | 'auto' | 'amount';

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Filtros que aplica cada ficha al pulsarla. «Vencen pronto» filtra los vigentes que vencen de hoy a hoy + 90 días. */
export function shortcutFilters(kind: KpiShortcut, now: Date = new Date()): ContractFilters {
  const today = isoDay(now);
  const limit = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ALERT_DAYS)));
  switch (kind) {
    case 'active': return { ...DEFAULT_FILTERS, vigencia: 'activos' };
    case 'expiring': return { ...DEFAULT_FILTERS, vigencia: 'activos', from: today, to: limit };
    case 'auto': return { ...DEFAULT_FILTERS, vigencia: 'activos', renewal: 'tacita' };
    case 'amount': return { ...DEFAULT_FILTERS, vigencia: 'activos', sort: 'importe_desc' };
  }
}

const SHORTCUTS: KpiShortcut[] = ['active', 'expiring', 'auto', 'amount'];
const sameFilters = (a: ContractFilters, b: ContractFilters): boolean => (Object.keys(a) as (keyof ContractFilters)[]).every((k) => a[k] === b[k]);

/** La ficha cuyo atajo coincide exactamente con los filtros actuales, si hay alguna. */
export function activeShortcut(filters: ContractFilters, now: Date = new Date()): KpiShortcut | null {
  return SHORTCUTS.find((kind) => sameFilters(filters, shortcutFilters(kind, now))) ?? null;
}

// ── Presentación de celdas ─────────────────────────────────────────────

const DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** AAAA-MM-DD (o ISO) → dd/mm/aaaa; «—» si no hay fecha. */
export function formatDate(iso?: string | null): string {
  return iso ? DATE.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—';
}

const money = (value: number, currency = 'EUR'): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export interface AmountText {
  /** Importe principal: el anual si se puede anualizar; si no, el que consta en el contrato. */
  main: string;
  /** Segunda línea: el equivalente mensual, o por qué no hay anual («Pago único»…). */
  sub: string | null;
}

/** Importe anual y mensual de un contrato (D5); sin anualizar se muestra tal como consta. */
export function amountText(c: Pick<EstateContract, 'costAmount' | 'costFrequency' | 'currency' | 'annualCost' | 'monthlyCost'>): AmountText {
  const currency = c.currency || 'EUR';
  if (c.annualCost != null) {
    return { main: money(c.annualCost, currency), sub: c.monthlyCost != null ? `(${money(c.monthlyCost, currency)}/mes)` : null };
  }
  if (c.costAmount == null) return { main: '—', sub: null };
  return { main: money(c.costAmount, currency), sub: c.costFrequency === 'ONE_OFF' ? 'Pago único' : 'Periodicidad no anualizable' };
}

/** Color estable por categoría (la misma categoría, siempre el mismo color), de la paleta de la aplicación. */
export function categoryColor(category: string): string {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ESTATE_COLOR_PALETTE[hash % ESTATE_COLOR_PALETTE.length] as string;
}

export const RENEWAL_LABEL: Record<string, string> = { tacita: 'Automática', manual: 'Manual' };

export const STATUS_PILL: Record<SupplierContractStatus, { text: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }> = {
  Programado: { text: 'Programado', tone: 'neutral' },
  Activo: { text: 'Activo', tone: 'positive' },
  PorVencer: { text: 'Por vencer', tone: 'warning' },
  Vencido: { text: 'Vencido', tone: 'danger' },
  Cancelado: { text: 'Cancelado', tone: 'neutral' },
};

// ── Acciones permitidas (D1) ───────────────────────────────────────────

/** Un contrato cancelado ya no se edita, renueva ni cancela; solo se consulta. */
export const canEdit = (c: Pick<EstateContract, 'status'>): boolean => c.status !== 'Cancelado';
export const canCancel = canEdit;
/** Renovar exige un contrato vivo y con fecha de fin (uno indefinido no tiene nada que renovar). */
export const canRenew = (c: Pick<EstateContract, 'status' | 'endDate'>): boolean => c.status !== 'Cancelado' && !!c.endDate;

export const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: 'mensual', QUARTERLY: 'trimestral', SEMIANNUAL: 'semestral', ANNUAL: 'anual', ONE_OFF: 'pago único', OTHER: 'otra periodicidad',
};
