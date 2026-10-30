import type { CompletenessOverview } from '../../core/office-setup.service';
import type { ClientsSummary, MrrMonth, MrrOverview } from '../../core/platform-metrics.service';
import type { StatChangeTone } from '../../shared/components/stat-card/stat-card.component';
import { formatEuro } from '../overview-b/overview-format';

/** One data source of the KPI row: `data` null + `error` false = still loading. */
export interface SourceState<T> {
  data: T | null;
  error: boolean;
}

export interface KpiSources {
  mrr: SourceState<MrrOverview>;
  clients: SourceState<ClientsSummary>;
  completeness: SourceState<CompletenessOverview>;
}

export interface KpiView {
  key: 'clients' | 'mrr' | 'trials' | 'pending' | 'tickets' | 'completeness';
  label: string;
  icon: string;
  value: string;
  sub: string;
  change: string;
  tone: StatChangeTone;
  trend: number[] | null;
  /** How it is calculated (S8 info icon). */
  info: string;
}

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const LONG_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** `2026-01` → «ene 26» (axis labels). */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${SHORT_MONTHS[Number(m) - 1]} ${year.slice(2)}`;
}

/** `2026-10` → «octubre de 2026». */
export function sinceLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${LONG_MONTHS[Number(m) - 1]} de ${year}`;
}

/** Months with captured data: earlier months of the window are «no data», never «zero MRR». */
export function historyMonths(mrr: MrrOverview): MrrMonth[] {
  return mrr.months.filter(m => m.month >= mrr.dataSince);
}

const LOADING = '…';
const MISSING = '—';
const FAILED = 'No se pudo cargar';
const NUMBER = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function percentChange(current: number, previous: number): { change: string; tone: StatChangeTone } {
  if (previous === 0) return { change: 'Sin MRR el mes anterior', tone: 'neutral' };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  if (pct === 0) return { change: '0 % vs. mes anterior', tone: 'neutral' };
  return { change: `${pct > 0 ? '+' : '−'}${NUMBER.format(Math.abs(pct))} % vs. mes anterior`, tone: pct > 0 ? 'positive' : 'danger' };
}

function countChange(current: number, previous: number): { change: string; tone: StatChangeTone } {
  const diff = current - previous;
  if (diff === 0) return { change: 'Igual que el mes anterior', tone: 'neutral' };
  return { change: `${diff > 0 ? '+' : '−'}${Math.abs(diff)} vs. mes anterior`, tone: diff > 0 ? 'positive' : 'danger' };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The six KPIs of the role A Vista general (S8); each source fails or loads on its own. */
export function buildKpis(s: KpiSources): KpiView[] {
  const mrr = s.mrr.data;
  const history = mrr ? historyMonths(mrr) : [];
  // The last month is the current one; the one before it, the comparison (only if it has data).
  const previous = history.length >= 2 ? history[history.length - 2] : null;
  const since = mrr ? sinceLabel(mrr.dataSince) : '';
  const historyNote = mrr ? ` El histórico empieza en ${since}: antes no se guardaba.` : '';
  const noHistory = { change: `Histórico desde ${since}`, tone: 'neutral' as StatChangeTone };
  const mrrState = s.mrr.error && !mrr ? FAILED : '';
  const placeholder = (state: SourceState<unknown>): string => (state.error ? MISSING : LOADING);

  const clients = s.clients.data;
  const pending = clients?.pendingInvoices;
  const inTermCount = pending ? pending.count - pending.overdueCount : 0;
  const inTermAmount = pending ? Math.round((pending.amount - pending.overdueAmount) * 100) / 100 : 0;
  const average = s.completeness.data?.average;

  const base = { sub: '', change: '', tone: 'neutral' as StatChangeTone, trend: null as number[] | null };

  return [
    {
      ...base,
      key: 'clients',
      label: 'Clientes activos',
      icon: 'users',
      value: mrr ? String(mrr.payingClients) : placeholder(s.mrr),
      sub: mrrState,
      ...(mrr ? (previous ? countChange(mrr.payingClients, previous.payingClients) : noHistory) : {}),
      trend: history.length >= 2 ? history.map(m => m.payingClients) : null,
      info: 'Despachos con suscripción activa que hoy aportan MRR: incluye los que están en periodo de gracia por un cobro fallido y los de facturación manual; excluye las cuentas en prueba, las suspendidas y las canceladas. La variación compara con el cierre del mes anterior.' + historyNote,
    },
    {
      ...base,
      key: 'mrr',
      label: 'MRR total',
      icon: 'chart',
      value: mrr ? formatEuro(mrr.currentMrr) : placeholder(s.mrr),
      sub: mrrState,
      ...(mrr ? (previous ? percentChange(mrr.currentMrr, previous.mrr) : noHistory) : {}),
      trend: history.length >= 2 ? history.map(m => m.mrr) : null,
      info: 'Ingresos recurrentes mensuales contratados, sin IVA: la cuota de cada suscripción activa o en periodo de gracia, con los descuentos vigentes aplicados y las anuales divididas entre 12. De momento excluye las cuentas en prueba. La variación compara con el cierre del mes anterior.' + historyNote,
    },
    {
      ...base,
      key: 'trials',
      label: 'Cuentas en prueba',
      icon: 'clock',
      value: clients ? String(clients.trials) : placeholder(s.clients),
      sub: s.clients.error && !clients ? FAILED : '',
      info: 'Despachos cuya suscripción está ahora en periodo de prueba. No cuentan en el MRR ni en los clientes activos hasta que empiezan a pagar.',
    },
    {
      ...base,
      key: 'pending',
      label: 'Pagos pendientes',
      icon: 'receipt',
      value: pending
        ? pending.count === 0 ? '0 facturas' : `${plural(pending.count, 'factura', 'facturas')} · ${formatEuro(pending.amount)}`
        : placeholder(s.clients),
      sub: !pending
        ? s.clients.error ? FAILED : ''
        : pending.count === 0
          ? 'Todo cobrado'
          : `${plural(pending.overdueCount, 'vencida', 'vencidas')} · ${formatEuro(pending.overdueAmount)} · ${inTermCount} en plazo · ${formatEuro(inTermAmount)}`,
      tone: pending && pending.overdueCount > 0 ? 'danger' : 'neutral',
      info: 'Facturas de Domora a sus clientes que aún no se han cobrado, con IVA (lo que debe el cliente). Las vencidas han pasado su fecha de pago; las que están en plazo todavía no.',
    },
    {
      ...base,
      key: 'tickets',
      label: 'Tickets abiertos',
      icon: 'message-square',
      value: MISSING,
      sub: 'Próximamente',
      info: 'Problemas o solicitudes de soporte de los despachos pendientes de resolución. Se mostrará cuando exista el módulo de soporte e incidencias.',
    },
    {
      ...base,
      key: 'completeness',
      label: 'Completitud media',
      icon: 'check-check',
      value: s.completeness.data ? (average === null || average === undefined ? MISSING : `${NUMBER.format(average)} %`) : placeholder(s.completeness),
      sub: s.completeness.error && !s.completeness.data ? FAILED : '',
      info: 'Media de la completitud de los despachos (sin contar los cancelados). La de cada despacho es al 50 % sus pasos de configuración y al 50 % la media de sus comunidades; solo cuentan los pasos obligatorios y recomendados.',
    },
  ];
}
