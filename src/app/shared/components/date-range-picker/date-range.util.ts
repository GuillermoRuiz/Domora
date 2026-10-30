/** Rango de fechas inclusivo en días locales, con fechas `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Devuelve la fecha local de un `YYYY-MM-DD` (sin saltos por huso horario) o `null` si no es válido. */
export function fromIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function addDays(iso: string, days: number): string {
  const date = fromIsoDate(iso) ?? new Date();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function addMonths(iso: string, months: number): string {
  const date = fromIsoDate(iso) ?? new Date();
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

export function orderRange(a: string, b: string): DateRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** Semanas (lunes a domingo) que cubren el mes de `anchorIso`, siempre 6 filas para que el panel no cambie de alto. */
export function buildMonthGrid(anchorIso: string): CalendarDay[][] {
  const anchor = fromIsoDate(anchorIso) ?? new Date();
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      row.push({ iso: toIsoDate(date), day: date.getDate(), inMonth: date.getMonth() === first.getMonth() });
    }
    weeks.push(row);
  }
  return weeks;
}

export function monthLabel(anchorIso: string): string {
  const date = fromIsoDate(anchorIso) ?? new Date();
  const label = date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return label.charAt(0).toLocaleUpperCase('es') + label.slice(1);
}

export function formatDay(iso: string, withYear = false): string {
  const date = fromIsoDate(iso);
  if (!date) return '';
  return date.toLocaleDateString('es-ES', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

export function formatRange(range: DateRange): string {
  if (range.from === range.to) return formatDay(range.from, true);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${formatDay(range.from, !sameYear)} – ${formatDay(range.to, true)}`;
}

/** Inicio del primer día y fin del último día del rango, en hora local. */
export function rangeBounds(range: DateRange): { start: number; end: number } | null {
  const from = fromIsoDate(range.from);
  const to = fromIsoDate(range.to);
  if (!from || !to) return null;
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime() - 1;
  return { start: from.getTime(), end };
}

export function presetRanges(now = new Date()): { label: string; range: DateRange }[] {
  const today = toIsoDate(now);
  return [
    { label: 'Hoy', range: { from: today, to: today } },
    { label: 'Últimos 7 días', range: { from: addDays(today, -6), to: today } },
    { label: 'Últimos 30 días', range: { from: addDays(today, -29), to: today } },
  ];
}
