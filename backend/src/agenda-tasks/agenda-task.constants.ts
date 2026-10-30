import type { AgendaTaskStatus, AgendaLinkType } from '../prisma/client';

/** Estados que ya no cuentan como trabajo pendiente ni pueden estar vencidos. */
export const TERMINAL_STATUSES: AgendaTaskStatus[] = [
  'COMPLETADA',
  'CANCELADA',
];

/**
 * Estados de trabajo sin resolver, en positivo. Las consultas de "trabajo abierto"
 * usan `status IN (…)` y no `NOT IN (terminales)` porque solo la primera forma puede
 * apoyarse en el índice (gestora, estado, fin): `NOT IN` es una condición negativa.
 */
export const OPEN_STATUSES: AgendaTaskStatus[] = [
  'PENDIENTE',
  'EN_CURSO',
  'EN_ESPERA',
];

export function isTerminal(status: AgendaTaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * ¿Es esta tarea trabajo humano VIVO? Sí mientras no sea terminal, `EN_ESPERA` incluida: una persona la miró y espera algo
 * (sigue siendo suya, pero no pide una decisión AHORA). Es la regla única de «hay una tarea», para el siguiente paso, la
 * proyección y el barrido; qué tareas piden atención ahora es un subconjunto (`taskNeedsAttention`).
 */
export function isTaskOperationallyActive(status: AgendaTaskStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** ¿Pide una decisión ahora? Las tareas vivas salvo las aparcadas (`EN_ESPERA`). */
export function taskNeedsAttention(status: AgendaTaskStatus): boolean {
  return isTaskOperationallyActive(status) && status !== 'EN_ESPERA';
}

/**
 * Una tarea está VENCIDA si ya terminó y sigue sin resolverse. Es un valor
 * derivado a propósito: guardarlo exigiría un cron que lo mantuviera y se
 * desincronizaría en cuanto alguien mueva la tarea.
 */
export function isOverdue(
  status: AgendaTaskStatus,
  end: Date,
  now: Date = new Date(),
): boolean {
  return !isTerminal(status) && end.getTime() < now.getTime();
}

/** Rango máximo (días) que acepta una consulta de calendario. */
export const MAX_RANGE_DAYS = 100;

/** Duración máxima de una tarea con hora (días). */
export const MAX_TASK_DURATION_DAYS = 31;

/** Tope de tareas leídas por consulta de calendario. */
export const MAX_RANGE_ITEMS = 1000;
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 200;

/** Antelación máxima de un recordatorio: 7 días. */
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;

export const MAX_ATTACHMENTS_PER_TASK = 20;
export const MAX_CHECKLIST_ITEMS = 100;

/** Valor de `source` de las tareas creadas por una persona. */
export const MANUAL_SOURCE = 'manual';

/** Etiquetas con las que arranca el catálogo de cada gestora. */
export const DEFAULT_LABELS: string[] = [
  'Proveedor',
  'Mantenimiento',
  'Ascensor',
  'Seguro',
  'Legal',
  'Presidente',
  'Junta',
  'Cobro',
  'Morosidad',
  'Incidencia',
  'Documentación',
  'Contrato',
  'Contabilidad',
  'Bloqueada',
  'Esperando tercero',
];

/** Pestaña de la ficha de finca donde se resuelve cada entidad vinculable. */
export const LINK_TAB: Record<AgendaLinkType, string> = {
  issue: 'issues',
  meeting: 'juntas',
  supplier: 'providers',
  document: 'documents',
};
