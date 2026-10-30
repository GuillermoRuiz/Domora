import { ReportDefinition, ReportInput } from '../../core/reporting.models';

export function normalizeReportSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function businessDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function todayMadrid(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}
export function defaultReportInput(definition: ReportDefinition): ReportInput {
  const [year, month, day] = todayMadrid().split('-').map(Number);
  const now = new Date(year, month - 1, day, 12); const mode = definition.periodMode;
  const input: ReportInput = { scopeMode: definition.scopeMode === 'single' ? 'selected' : 'all', estateIds: [], filters: {} };
  if (mode === 'year' || mode === 'quarter') input.fiscalYear = now.getFullYear();
  if (mode === 'quarter') input.quarter = Math.floor(now.getMonth() / 3) + 1;
  if (mode === 'asOf') input.asOf = businessDate(now);
  if (mode === 'range' || mode === 'comparison') {
    input.from = businessDate(new Date(now.getFullYear(), now.getMonth(), 1)); input.to = businessDate(now);
    if (definition.key === 'monthly-executive') {
      input.from = businessDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      input.to = businessDate(new Date(now.getFullYear(), now.getMonth(), 0));
    }
  }
  if (mode === 'comparison') {
    input.compareFrom = businessDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    input.compareTo = businessDate(new Date(now.getFullYear(), now.getMonth(), 0));
  }
  if (definition.filters.includes('days')) input.filters!.days = 30;
  if (definition.filters.includes('assignmentMode')) input.filters!.assignmentMode = 'current';
  if (definition.filters.includes('spendBasis')) input.filters!.spendBasis = 'invoiced';
  return input;
}
export function reportInputError(input: ReportInput, definition: ReportDefinition): string {
  if (definition.scopeMode === 'single' && (input.scopeMode !== 'selected' || input.estateIds?.length !== 1)) return 'Selecciona una comunidad para generar este informe.';
  if (input.scopeMode === 'selected' && !input.estateIds?.length) return 'Selecciona al menos una comunidad.';
  const mode = definition.periodMode;
  if ((mode === 'range' || mode === 'comparison') && (!input.from || !input.to || input.from > input.to)) return 'Selecciona un rango de fechas válido: Desde debe ser anterior o igual a Hasta.';
  if (mode === 'comparison' && (!input.compareFrom || !input.compareTo || input.compareFrom > input.compareTo)) return 'Selecciona un periodo de comparación válido.';
  if ((mode === 'year' || mode === 'quarter') && (!Number.isInteger(input.fiscalYear) || input.fiscalYear! < 2000 || input.fiscalYear! > 2100)) return 'Introduce un ejercicio válido entre 2000 y 2100.';
  if (mode === 'asOf' && !input.asOf) return 'Selecciona la fecha de corte.';
  if (definition.key === 'monthly-executive' && input.from && input.to) {
    const [year, month] = input.from.split('-').map(Number);
    if (!input.from.endsWith('-01') || input.to !== businessDate(new Date(year, month, 0))) return 'Selecciona un mes natural completo, desde el primer hasta el último día del mes.';
  }
  if (['monthly-executive', 'meeting-finance'].includes(definition.key) && input.to && input.to > todayMadrid()) return 'La fecha final no puede ser futura en este informe.';
  if (definition.filters.includes('accountCode') && !/^[0-9]{1,10}$/.test(input.filters?.accountCode ?? '')) return 'Introduce el código de la cuenta contable: de 1 a 10 dígitos.';
  if (input.filters?.days !== undefined && (!Number.isInteger(input.filters.days) || input.filters.days < 1 || input.filters.days > 3650)) return 'El plazo debe ser un número entero entre 1 y 3650 días.';
  return '';
}
function dateLabel(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-ES');
}
export function reportPeriodLabel(period: ReportInput | Pick<ReportInput, 'from' | 'to' | 'asOf' | 'fiscalYear' | 'quarter' | 'compareFrom' | 'compareTo'>): string {
  const parts: string[] = [];
  if (period.from && period.to) parts.push(`${dateLabel(period.from)} – ${dateLabel(period.to)} (ambos incluidos)`);
  if (period.asOf) parts.push(`A fecha de ${dateLabel(period.asOf)}`);
  if (period.fiscalYear) parts.push(`Ejercicio ${period.fiscalYear}${period.quarter ? ` · Trimestre ${period.quarter}` : ''}`);
  if (period.compareFrom && period.compareTo) parts.push(`Comparado con ${dateLabel(period.compareFrom)} – ${dateLabel(period.compareTo)}`);
  return parts.join(' · ') || 'Sin filtro de periodo';
}
export function formatReportValue(value: string | number, format: 'money' | 'number' | 'text'): string {
  if (format === 'text') return String(value);
  return new Intl.NumberFormat('es-ES', format === 'money' ? { style: 'currency', currency: 'EUR' } : {}).format(Number(value));
}
/** Business dates have no timezone; only their presentation changes. */
export function formatReportCell(value: string | number | null | undefined, kind?: string, key?: string): string | number | null | undefined {
  const dateFields = ['date', 'created', 'resolved', 'closed', 'start', 'end', 'issue', 'accrual', 'due', 'issued'];
  if (dateFields.includes(key ?? '') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateLabel(value);
  if (kind === 'int' && value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value).toLocaleString('es-ES');
  return value;
}
