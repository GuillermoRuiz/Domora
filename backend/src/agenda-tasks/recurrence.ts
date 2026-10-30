/**
 * Expansión de tareas recurrentes. Una serie es UNA fila (inicio + duración +
 * regla); las ocurrencias se calculan al consultar un rango, así que una
 * revisión mensual durante diez años no genera ciento veinte registros.
 *
 * La aritmética se hace sobre la HORA LOCAL de la zona de la tarea y no sobre
 * milisegundos: "cada día a las 10:00" tiene que seguir siendo las 10:00 tras
 * el cambio de hora, no desplazarse a las 09:00 o las 11:00. La duración sí
 * se conserva en milisegundos absolutos.
 *
 * Las tareas de día completo no tienen hora: se calculan en UTC (su
 * `startAt` es una medianoche UTC que representa una fecha de calendario).
 */

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Cada cuántas unidades se repite (1 = cada día/semana/mes/año). */
  interval: number;
  /** Última fecha en la que puede EMPEZAR una ocurrencia (inclusive). */
  until: Date | null;
}

export interface SeriesSpec {
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string;
  rule: RecurrenceRule | null;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

/** Campos de una fila `agenda_tasks` que definen su serie. */
export interface SeriesRow {
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string;
  recurrenceFreq: RecurrenceFreq | null;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
}

export function seriesSpecOf(row: SeriesRow): SeriesSpec {
  return {
    startAt: row.startAt,
    endAt: row.endAt,
    allDay: row.allDay,
    timezone: row.timezone,
    rule: row.recurrenceFreq
      ? {
          freq: row.recurrenceFreq,
          interval: row.recurrenceInterval,
          until: row.recurrenceUntil,
        }
      : null,
  };
}

/** Tope de seguridad de ocurrencias por consulta: protege de rangos absurdos. */
export const MAX_OCCURRENCES = 500;

const DAY_MS = 86_400_000;

/** Longitud MÁXIMA de cada unidad: da una cota inferior segura del índice. */
const MAX_UNIT_MS: Record<RecurrenceFreq, number> = {
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
  MONTHLY: 31 * DAY_MS,
  YEARLY: 366 * DAY_MS,
};

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** `true` si `timezone` es una zona IANA que el runtime conoce. */
export function isValidTimezone(timezone: string): boolean {
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

function wallTimeOf(instant: Date, timezone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year'],
    month: parts['month'],
    day: parts['day'],
    hour: parts['hour'],
    minute: parts['minute'],
    second: parts['second'],
  };
}

function wallAsUtcMs(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Desfase (ms) de la zona respecto a UTC en el instante dado. */
function offsetMs(instantMs: number, timezone: string): number {
  const truncated = Math.floor(instantMs / 1000) * 1000;
  return wallAsUtcMs(wallTimeOf(new Date(truncated), timezone)) - truncated;
}

/**
 * Instante UTC que corresponde a una hora local. Si la hora no existe (salto
 * de primavera) cae en la siguiente válida; si existe dos veces (otoño) se
 * queda con la primera.
 */
function wallToUtc(w: WallTime, timezone: string): Date {
  const guess = wallAsUtcMs(w);
  const first = guess - offsetMs(guess, timezone);
  const second = guess - offsetMs(first, timezone);
  return new Date(second === first ? first : Math.min(first, second));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Suma `count` unidades a la fecha local; el día se ajusta al fin de mes. */
function addUnits(
  base: WallTime,
  freq: RecurrenceFreq,
  count: number,
): WallTime {
  if (freq === 'DAILY' || freq === 'WEEKLY') {
    const days = freq === 'DAILY' ? count : count * 7;
    const shifted = new Date(
      Date.UTC(base.year, base.month - 1, base.day + days),
    );
    return {
      ...base,
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }
  const months = freq === 'MONTHLY' ? count : count * 12;
  const total = base.year * 12 + (base.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return {
    ...base,
    year,
    month,
    day: Math.min(base.day, daysInMonth(year, month)),
  };
}

export function occurrenceAt(spec: SeriesSpec, index: number): Occurrence {
  const rule = spec.rule;
  if (!rule || index === 0) return { start: spec.startAt, end: spec.endAt };
  const duration = spec.endAt.getTime() - spec.startAt.getTime();
  const zone = spec.allDay ? 'UTC' : spec.timezone;
  const base = wallTimeOf(spec.startAt, zone);
  const wall = addUnits(base, rule.freq, index * rule.interval);
  const start = wallToUtc(wall, zone);
  return { start, end: new Date(start.getTime() + duration) };
}

/**
 * ¿Solapa la ocurrencia con [from, to)? Fin exclusivo, salvo las tareas de
 * duración cero (un instante), que cuentan si caen dentro del rango.
 */
export function occurrenceOverlaps(
  o: Occurrence,
  from: Date,
  to: Date,
): boolean {
  return (
    o.start.getTime() < to.getTime() &&
    (o.end.getTime() > from.getTime() ||
      (o.end.getTime() === o.start.getTime() &&
        o.start.getTime() >= from.getTime()))
  );
}

/**
 * Las tareas de día completo no son instantes sino fechas (medianoches UTC).
 * Para saber qué días de calendario abarca un rango de INSTANTES pedido por un
 * cliente hay que mirarlo en la zona del cliente: en Madrid, "hoy" es
 * [ayer 22:00Z, hoy 22:00Z), y la tarea de día completo de ayer (ayer 00:00Z –
 * hoy 00:00Z) solaparía 2 horas con él aunque sea del día anterior.
 *
 * Devuelve ese mismo rango como fechas de calendario en medianoches UTC.
 */
export function calendarDayRange(
  from: Date,
  to: Date,
  timezone: string,
): { from: Date; to: Date } {
  const first = wallTimeOf(from, timezone);
  const lastInstant = new Date(Math.max(from.getTime(), to.getTime() - 1));
  const last = wallTimeOf(lastInstant, timezone);
  return {
    from: new Date(Date.UTC(first.year, first.month - 1, first.day)),
    to: new Date(Date.UTC(last.year, last.month - 1, last.day + 1)),
  };
}

/**
 * Instante real en que empieza (en `timezone`) el día de calendario que
 * representa una medianoche UTC. Es el "momento" de una tarea de día completo
 * para vencimientos y recordatorios.
 */
export function localMidnightOf(utcMidnight: Date, timezone: string): Date {
  return wallToUtc(
    {
      year: utcMidnight.getUTCFullYear(),
      month: utcMidnight.getUTCMonth() + 1,
      day: utcMidnight.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );
}

/** Posición (0 = la primera) de una ocurrencia dentro de su serie, o null si no lo es. */
export function occurrenceIndexOf(
  spec: SeriesSpec,
  start: Date,
): number | null {
  const rule = spec.rule;
  if (!rule) return start.getTime() === spec.startAt.getTime() ? 0 : null;
  const elapsed = start.getTime() - spec.startAt.getTime();
  if (elapsed < 0) return null;
  let index = Math.max(
    0,
    Math.floor(elapsed / (MAX_UNIT_MS[rule.freq] * rule.interval)) - 1,
  );
  for (let guard = 0; guard < 5_000; guard += 1, index += 1) {
    const candidate = occurrenceAt(spec, index).start.getTime();
    if (candidate === start.getTime()) return index;
    if (candidate > start.getTime()) return null;
  }
  return null;
}

/**
 * Ocurrencias de la serie que SOLAPAN con [from, to). Para una tarea sin
 * regla devuelve la propia tarea si solapa.
 */
export function occurrencesBetween(
  spec: SeriesSpec,
  from: Date,
  to: Date,
  limit: number = MAX_OCCURRENCES,
): Occurrence[] {
  const overlaps = (o: Occurrence) => occurrenceOverlaps(o, from, to);

  const rule = spec.rule;
  if (!rule)
    return overlaps(occurrenceAt(spec, 0)) ? [occurrenceAt(spec, 0)] : [];

  const duration = spec.endAt.getTime() - spec.startAt.getTime();
  const elapsed = from.getTime() - duration - spec.startAt.getTime();
  const unitsBefore = Math.floor(elapsed / MAX_UNIT_MS[rule.freq]) - 1;
  let index = Math.max(0, Math.floor(unitsBefore / rule.interval));

  const result: Occurrence[] = [];
  // El bucle termina por rango, por `until` o por `limit` (nunca infinito).
  for (
    let guard = 0;
    guard < limit * 4 && result.length < limit;
    guard += 1, index += 1
  ) {
    const occurrence = occurrenceAt(spec, index);
    if (occurrence.start.getTime() >= to.getTime()) break;
    if (rule.until && occurrence.start.getTime() > rule.until.getTime()) break;
    if (overlaps(occurrence)) result.push(occurrence);
  }
  return result;
}

/**
 * Primera ocurrencia que EMPIEZA en o después de `instant` y antes de
 * `horizon`; `null` si no hay ninguna (serie terminada o fuera de ventana).
 */
export function firstStartingFrom(
  spec: SeriesSpec,
  instant: Date,
  horizon: Date,
): Occurrence | null {
  const candidates = occurrencesBetween(spec, instant, horizon);
  return candidates.find((o) => o.start.getTime() >= instant.getTime()) ?? null;
}

/** `true` si `start` es exactamente el inicio de una ocurrencia de la serie. */
export function isOccurrenceStart(spec: SeriesSpec, start: Date): boolean {
  const from = new Date(start.getTime() - 1);
  const to = new Date(start.getTime() + 1);
  return occurrencesBetween(spec, from, to, 8).some(
    (o) => o.start.getTime() === start.getTime(),
  );
}
