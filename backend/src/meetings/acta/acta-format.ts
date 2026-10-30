/**
 * Formato de fechas, horas y porcentajes del acta. Siempre en es-ES y en la zona horaria de
 * la reunión (Europe/Madrid), no en la del servidor: el mismo acta se ve igual en cualquier
 * máquina.
 */
export const ACTA_TIME_ZONE = 'Europe/Madrid';

const dateFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: ACTA_TIME_ZONE,
});
const timeFormat = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ACTA_TIME_ZONE,
});
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ACTA_TIME_ZONE });
const percentFormat = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parse(iso: string | Date | null | undefined): Date | null {
  if (iso == null) return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «14 de octubre de 2026». */
export function formatActaDate(iso: string | Date | null | undefined): string | null {
  const date = parse(iso);
  return date ? dateFormat.format(date) : null;
}

/** «19:05». */
export function formatActaTime(iso: string | Date | null | undefined): string | null {
  const date = parse(iso);
  return date ? timeFormat.format(date) : null;
}

/** Día civil de la reunión (YYYY-MM-DD) para saber si dos instantes caen el mismo día. */
export function actaDayKey(iso: string | Date | null | undefined): string | null {
  const date = parse(iso);
  return date ? dayKeyFormat.format(date) : null;
}

/** «2,50 %» (dos decimales, coma decimal). */
export function formatActaPercent(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? `${percentFormat.format(number)} %` : '—';
}

/** Mayúscula inicial sin tocar el resto. */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
