import { AgendaTask } from '../../core/agenda-tasks.model';

/**
 * Fechas y maquetación del calendario de Tareas. Funciones puras (sin Angular)
 * para poder probarlas aisladas.
 *
 * Convenciones:
 * - Todo el calendario trabaja en HORA LOCAL del navegador; la semana empieza
 *   en lunes.
 * - Las tareas de día completo guardan medianoches UTC que representan una
 *   fecha de calendario (fin exclusivo): su día se lee en UTC, nunca en local,
 *   o se desplazarían un día en zonas al oeste de Greenwich.
 */

export type CalendarView = 'day' | 'week' | 'month';

export const MINUTES_PER_DAY = 24 * 60;
/** Alto visual mínimo de un bloque (min), para que una tarea corta siga siendo legible. */
export const MIN_BLOCK_MINUTES = 30;
const DAY_MS = 86_400_000;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
}

/** Lunes de la semana de `date`. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `yyyy-mm-dd` en hora local. */
export function dateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export interface ViewRange {
  /** Inicio (incl.) y fin (excl.) de lo que se pide al servidor. */
  from: Date;
  to: Date;
  /** Días que se pintan (en el mes, la cuadrícula completa de semanas). */
  days: Date[];
}

export function viewRange(view: CalendarView, anchor: Date): ViewRange {
  let first: Date;
  let count: number;
  if (view === 'day') {
    first = startOfDay(anchor);
    count = 1;
  } else if (view === 'week') {
    first = startOfWeek(anchor);
    count = 7;
  } else {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    first = startOfWeek(monthStart);
    const last = addDays(startOfWeek(monthEnd), 6);
    count = Math.round((startOfDay(last).getTime() - first.getTime()) / DAY_MS) + 1;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { from: first, to: addDays(first, count), days };
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAY_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

/** "12 – 18 octubre 2026", "28 sep – 4 oct 2026", "14 de octubre de 2026"… */
export function periodLabel(view: CalendarView, anchor: Date): string {
  if (view === 'month') return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  if (view === 'day') {
    return `${WEEKDAY_NAMES[anchor.getDay()]} ${anchor.getDate()} ${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

export function longDateLabel(date: Date): string {
  return `${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ── Tareas sobre el calendario ──────────────────────────────────────────

/** Claves `yyyy-mm-dd` (en UTC) de los días que abarca una tarea de día completo. */
function allDayKeys(task: AgendaTask): string[] {
  const start = new Date(task.occurrenceStart);
  const end = new Date(task.occurrenceEnd);
  const keys: string[] = [];
  for (let t = start.getTime(); t < Math.max(end.getTime(), start.getTime() + 1); t += DAY_MS) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys;
}

export interface DaySegment {
  task: AgendaTask;
  /** Minutos desde las 00:00 del día. */
  startMin: number;
  endMin: number;
  /** Fin visual (con el alto mínimo aplicado). */
  visualEndMin: number;
  /** Posición dentro de las tareas que se solapan. */
  column: number;
  columns: number;
}

export interface DayBucket {
  allDay: AgendaTask[];
  /** Sin duración: solo cuentan por su día; el calendario las pinta como notas del día (sticky). */
  notes: AgendaTask[];
  timed: DaySegment[];
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Reparte columnas entre bloques que se solapan en el tiempo. */
function assignColumns(segments: DaySegment[]): void {
  segments.sort((a, b) => a.startMin - b.startMin || b.visualEndMin - a.visualEndMin);
  let cluster: DaySegment[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = cluster.reduce((max, s) => Math.max(max, s.column + 1), 1);
    cluster.forEach((s) => (s.columns = columns));
    cluster = [];
  };
  const columnEnds: number[] = [];
  for (const segment of segments) {
    if (cluster.length > 0 && segment.startMin >= clusterEnd) {
      flush();
      columnEnds.length = 0;
    }
    let column = columnEnds.findIndex((end) => end <= segment.startMin);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = segment.visualEndMin;
    segment.column = column;
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.visualEndMin);
  }
  if (cluster.length > 0) flush();
}

/** Agrupa las tareas por día visible: "todo el día" aparte y bloques con hora ya maquetados. */
export function bucketByDay(tasks: AgendaTask[], days: Date[]): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();
  for (const day of days) buckets.set(dateKey(day), { allDay: [], notes: [], timed: [] });

  for (const task of tasks) {
    if (task.noDuration) {
      buckets.get(dateKey(taskDay(task)))?.notes.push(task);
      continue;
    }
    if (task.allDay) {
      for (const key of allDayKeys(task)) buckets.get(key)?.allDay.push(task);
      continue;
    }
    const start = new Date(task.occurrenceStart);
    const end = new Date(task.occurrenceEnd);
    for (const day of days) {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = dayStart + DAY_MS;
      const overlaps = start.getTime() < dayEnd && (end.getTime() > dayStart || (end.getTime() === start.getTime() && start.getTime() >= dayStart));
      if (!overlaps) continue;
      const startMin = start.getTime() <= dayStart ? 0 : minutesOfDay(start);
      const endMin = end.getTime() >= dayEnd ? MINUTES_PER_DAY : minutesOfDay(end);
      const visualEndMin = Math.min(MINUTES_PER_DAY, Math.max(endMin, startMin + MIN_BLOCK_MINUTES));
      buckets.get(dateKey(day))?.timed.push({ task, startMin, endMin, visualEndMin, column: 0, columns: 1 });
    }
  }
  for (const bucket of buckets.values()) assignColumns(bucket.timed);
  return buckets;
}

/** Todas las tareas de un día (todo el día + con hora), ordenadas para una agenda. */
export function tasksOfDay(bucket: DayBucket | undefined): AgendaTask[] {
  if (!bucket) return [];
  return [...bucket.notes, ...bucket.allDay, ...[...bucket.timed].sort((a, b) => a.startMin - b.startMin).map((s) => s.task)];
}

/** Día de calendario de una ocurrencia: las de día completo se leen en UTC, el resto en local. */
export function taskDay(task: AgendaTask): Date {
  const start = new Date(task.occurrenceStart);
  return task.allDay ? new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) : start;
}

export function timeRangeLabel(task: AgendaTask): string {
  if (task.noDuration) return 'Sin duración';
  if (task.allDay) {
    const days = allDayKeys(task).length;
    return days > 1 ? `Todo el día (${days} días)` : 'Todo el día';
  }
  const start = new Date(task.occurrenceStart);
  const end = new Date(task.occurrenceEnd);
  if (end.getTime() === start.getTime()) return formatTime(start);
  // Una tarea que acaba otro día lo dice: «18:00 – 17 oct, 09:00».
  if (!sameDay(start, end)) return `${formatTime(start)} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}, ${formatTime(end)}`;
  return `${formatTime(start)} – ${formatTime(end)}`;
}

// ── Formularios (fecha y hora locales ↔ ISO) ────────────────────────────

export function toDateInput(date: Date): string {
  return dateKey(date);
}

export function toTimeInput(date: Date): string {
  return formatTime(date);
}

/** Combina `yyyy-mm-dd` y `HH:mm` (locales) en un instante. */
export function combineLocal(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

/** Medianoche UTC de una fecha `yyyy-mm-dd`: así se guardan las tareas de día completo. */
export function allDayIso(date: string, plusDays = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + plusDays)).toISOString();
}

/** Fecha `yyyy-mm-dd` que representa una medianoche UTC de día completo. */
export function allDayDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/** Lo máximo que dura una tarea (el servidor la rechaza si pasa de ahí). */
export const MAX_TASK_DAYS = 31;

/** `yyyy-mm-dd` sumando `days` días a otra fecha `yyyy-mm-dd` (sin pasar por la hora local). */
export function addDaysToDateInput(date: string, days: number): string {
  return allDayIso(date, days).slice(0, 10);
}

/** Días de calendario entre dos fechas `yyyy-mm-dd`. */
export function daysBetweenDateInputs(from: string, to: string): number {
  return Math.round((new Date(allDayIso(to)).getTime() - new Date(allDayIso(from)).getTime()) / DAY_MS);
}

/**
 * Fin que corresponde a un inicio nuevo conservando lo que duraba la tarea: al mover el inicio, el fin se mueve con él
 * (como en cualquier calendario), y el usuario solo toca el fin para cambiar la duración.
 */
export function endAfterStartChange(
  previous: { date: string; time: string; endDate: string; endTime: string },
  next: { date: string; time: string },
  allDay: boolean,
): { endDate: string; endTime: string } {
  if (!next.date) return { endDate: previous.endDate, endTime: previous.endTime };
  if (allDay) {
    const span = previous.date && previous.endDate ? Math.max(0, daysBetweenDateInputs(previous.date, previous.endDate)) : 0;
    return { endDate: addDaysToDateInput(next.date, span), endTime: previous.endTime };
  }
  const oldStart = combineLocal(previous.date, previous.time);
  const oldEnd = combineLocal(previous.endDate || previous.date, previous.endTime || previous.time);
  const duration = previous.date && previous.endDate ? Math.max(0, oldEnd.getTime() - oldStart.getTime()) : 3_600_000;
  const end = new Date(combineLocal(next.date, next.time).getTime() + duration);
  return { endDate: toDateInput(end), endTime: toTimeInput(end) };
}

/** Por qué no vale el horario escrito, o null si vale. */
export function scheduleProblem(
  schedule: { date: string; time: string; endDate: string; endTime: string },
  allDay: boolean,
): string | null {
  if (allDay && (!schedule.date || !schedule.endDate)) return 'Indica la fecha de inicio y la de fin.';
  if (!allDay && (!schedule.date || !schedule.time || !schedule.endDate || !schedule.endTime))
    return 'Indica la fecha y la hora de inicio y de fin.';
  if (allDay) {
    const days = daysBetweenDateInputs(schedule.date, schedule.endDate);
    if (days < 0) return 'La fecha de fin no puede ser anterior a la de inicio.';
    if (days + 1 > MAX_TASK_DAYS) return `Una tarea no puede durar más de ${MAX_TASK_DAYS} días.`;
    return null;
  }
  const start = combineLocal(schedule.date, schedule.time);
  const end = combineLocal(schedule.endDate, schedule.endTime);
  if (end.getTime() < start.getTime()) return 'La fecha y hora de fin no pueden ser anteriores a las de inicio.';
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_TASK_DAYS) return `Una tarea no puede durar más de ${MAX_TASK_DAYS} días.`;
  return null;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

/** Próxima hora en punto desde `now` (para preseleccionar en "Nueva tarea"). */
export function nextFullHour(now: Date): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  return next;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Tarea abierta de una incidencia que vence después del periodo visible: el servidor la manda igualmente para la tabla y
 * el tablero; el calendario no la pinta en la cuadrícula sino como «pendiente» arriba.
 */
export function isUpcoming(task: AgendaTask, rangeEnd: Date): boolean {
  return task.source === 'issue' && !task.recurring && new Date(task.occurrenceStart).getTime() >= rangeEnd.getTime();
}

/** «mié 28 oct, 10:00»: cuándo vence una tarea pendiente. */
export function dueLabel(task: AgendaTask): string {
  const d = new Date(task.occurrenceStart);
  const day = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return day.replace(/./g, '') + ', ' + formatTime(d);
}

// ── Acciones sobre una tarea (menú de la ventana rápida y del detalle) ───

export type TaskAction = 'complete' | 'reopen' | 'cancel' | 'delete';

/**
 * Acciones que admite la tarea. Una decisión de Domora solo se cierra decidiendo, desde su detalle:
 * ni completar, ni cancelar, ni reabrir a mano; eliminar sí.
 */
export function taskActionItems(task: Pick<AgendaTask, 'status' | 'kind'>): { id: TaskAction; label: string; icon: string }[] {
  const terminal = task.status === 'COMPLETADA' || task.status === 'CANCELADA';
  const items: { id: TaskAction; label: string; icon: string }[] = [];
  if (!task.kind) {
    items.push(terminal ? { id: 'reopen', label: 'Reabrir', icon: 'refresh' } : { id: 'complete', label: 'Completar', icon: 'check' });
    if (task.status !== 'CANCELADA') items.push({ id: 'cancel', label: 'Cancelar tarea', icon: 'x' });
  }
  // Una revisión de incidencia no se completa a secas: se resuelve en su detalle diciendo cómo sigue la incidencia.
  items.push({ id: 'delete', label: 'Eliminar', icon: 'trash' });
  return items;
}
