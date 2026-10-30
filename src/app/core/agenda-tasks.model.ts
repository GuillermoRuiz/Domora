/**
 * Modelo de la agenda de tareas ("Tareas"). Los valores de los enums son los
 * mismos que devuelve la API (identificadores Prisma, sin acentos): aquí solo
 * viven sus etiquetas y metadatos de presentación.
 *
 * No confundir con `TaskItem`/`TaskKind` de models.ts, que describen la lista
 * de trabajo DERIVADA de Notificaciones (`GET /tasks`).
 */

export type AgendaTaskType =
  | 'SEGUIMIENTO' | 'CORREO' | 'COMUNICACION' | 'LLAMADA' | 'JUNTA' | 'PRESUPUESTO'
  | 'INCIDENCIA' | 'DOCUMENTACION' | 'COBRO_PAGO' | 'VISITA' | 'MANTENIMIENTO'
  | 'PROVEEDOR' | 'CONTABILIDAD' | 'CONTRATO' | 'SEGURO' | 'LEGAL' | 'ADMINISTRATIVA' | 'OTRA';

export type AgendaTaskPriority = 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAJA';

export type AgendaTaskStatus = 'PENDIENTE' | 'EN_CURSO' | 'EN_ESPERA' | 'COMPLETADA' | 'CANCELADA';

export type AgendaRecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export type AgendaLinkType = 'issue' | 'meeting' | 'supplier' | 'document';

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface TaskLabel {
  id: string;
  name: string;
}

export interface TaskRecurrence {
  freq: AgendaRecurrenceFreq;
  interval: number;
  /** Último día en que puede empezar una ocurrencia (ISO) o null = sin fin. */
  until: string | null;
}

/** Tarea tal y como llega al calendario: una por ocurrencia si es una serie. */
export interface AgendaTask {
  id: string;
  occurrenceKey: string;
  recurring: boolean;
  occurrenceStart: string;
  occurrenceEnd: string;
  title: string;
  estate: { id: string; name: string } | null;
  assignee: PersonRef | null;
  type: AgendaTaskType;
  priority: AgendaTaskPriority;
  status: AgendaTaskStatus;
  /** Calculado en servidor: terminó y sigue sin completar/cancelar. */
  overdue: boolean;
  allDay: boolean;
  /** Sin duración: solo cuenta el día de inicio; el calendario la pinta como nota del día. */
  noDuration?: boolean;
  timezone: string;
  startAt: string;
  endAt: string;
  /** Fecha límite propia; `null` = vence al acabar el bloque (`endAt`). Mover la tarea no la cambia. */
  dueAt?: string | null;
  reminderMinutesBefore: number | null;
  recurrence: TaskRecurrence | null;
  labels: TaskLabel[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  attachmentCount: number;
  linkCount: number;
  source: string;
  /** Null en las tareas que abre Domora: ver `createdByKind`. */
  createdByUserId: string | null;
  createdByKind: 'person' | 'ai' | 'system';
  /** Incidencia de la que nace (solo las tareas de decisión humana que abre Domora). */
  issueId: string | null;
  /** Tipo de acción humana; null en las tareas manuales. */
  kind: string | null;
}

export interface LinkedEntity {
  type: AgendaLinkType;
  id: string;
  label: string;
  estateId: string;
  /** Ruta del frontend donde se abre la entidad (vacía si ya no existe). */
  route: string;
  /** La entidad ya no existe: el vínculo se conserva como historia, con el título que tenía al vincularla. */
  deleted?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface TaskComment {
  id: string;
  text: string;
  createdAt: string;
  author: PersonRef | null;
}

export interface TaskAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AgendaTaskDetail extends AgendaTask {
  /** Solo en el detalle: el calendario no carga el texto largo. */
  description: string | null;
  createdBy: PersonRef | null;
  /** Datos de la decisión (validados por `kind`) y cómo se resolvió. */
  payload: unknown;
  outcome: string | null;
  resultRef: unknown;
  createdAt: string;
  updatedAt: string;
  checklist: ChecklistItem[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  links: LinkedEntity[];
}

/** Resultado de listar tareas: `truncated` indica que el servidor alcanzó un tope y faltan elementos. */
export interface AgendaTaskList {
  items: AgendaTask[];
  truncated: boolean;
}

/** Filtros de la consulta; `assignee` admite 'me' | 'none' | id de usuario. */
export interface AgendaQuery {
  from?: string;
  to?: string;
  estateId?: string;
  assignee?: string;
  status?: AgendaTaskStatus[];
  priority?: AgendaTaskPriority[];
  type?: AgendaTaskType[];
  labelIds?: string[];
  q?: string;
}

export interface CreateAgendaTaskPayload {
  title: string;
  description?: string;
  estateId?: string;
  assignedToUserId?: string;
  type?: AgendaTaskType;
  priority?: AgendaTaskPriority;
  status?: AgendaTaskStatus;
  startAt: string;
  endAt: string;
  /** Fecha límite propia, distinta de cuándo se hace. */
  dueAt?: string | null;
  allDay?: boolean;
  noDuration?: boolean;
  timezone?: string;
  reminderMinutesBefore?: number;
  recurrence?: { freq: AgendaRecurrenceFreq; interval: number; until?: string | null };
  labelIds?: string[];
  checklist?: string[];
  links?: { type: AgendaLinkType; id: string }[];
}

/** En los campos anulables, `null` borra el valor y omitirlos lo deja igual. */
export interface UpdateAgendaTaskPayload {
  title?: string;
  description?: string | null;
  estateId?: string | null;
  assignedToUserId?: string | null;
  type?: AgendaTaskType;
  priority?: AgendaTaskPriority;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  noDuration?: boolean;
  timezone?: string;
  reminderMinutesBefore?: number | null;
  recurrence?: { freq: AgendaRecurrenceFreq; interval: number; until?: string | null } | null;
  labelIds?: string[];
  links?: { type: AgendaLinkType; id: string }[];
}

// ── Presentación ─────────────────────────────────────────────────────────

export interface TypeMeta {
  label: string;
  /** Nombre de un icono de `IconComponent`. */
  icon: string;
}

/** Orden = orden del catálogo en los selectores. */
export const TASK_TYPES: Record<AgendaTaskType, TypeMeta> = {
  SEGUIMIENTO: { label: 'Seguimiento', icon: 'refresh' },
  CORREO: { label: 'Correo', icon: 'mail' },
  COMUNICACION: { label: 'Comunicación', icon: 'send' },
  LLAMADA: { label: 'Llamada', icon: 'phone' },
  JUNTA: { label: 'Junta', icon: 'users' },
  PRESUPUESTO: { label: 'Presupuesto', icon: 'receipt' },
  INCIDENCIA: { label: 'Incidencia', icon: 'exclamation' },
  DOCUMENTACION: { label: 'Documentación', icon: 'file-text' },
  COBRO_PAGO: { label: 'Cobro / Pago', icon: 'card' },
  VISITA: { label: 'Visita', icon: 'map-pin' },
  MANTENIMIENTO: { label: 'Mantenimiento', icon: 'settings' },
  PROVEEDOR: { label: 'Proveedor', icon: 'store' },
  CONTABILIDAD: { label: 'Contabilidad', icon: 'chart' },
  CONTRATO: { label: 'Contrato', icon: 'file' },
  SEGURO: { label: 'Seguro', icon: 'home' },
  LEGAL: { label: 'Legal', icon: 'gavel' },
  ADMINISTRATIVA: { label: 'Administrativa', icon: 'table' },
  OTRA: { label: 'Otra', icon: 'ellipsis' },
};

export const TASK_TYPE_KEYS = Object.keys(TASK_TYPES) as AgendaTaskType[];

export const TASK_PRIORITIES: Record<AgendaTaskPriority, { label: string; icon: string }> = {
  URGENTE: { label: 'Urgente', icon: 'exclamation' },
  ALTA: { label: 'Alta', icon: 'trending-up' },
  MEDIA: { label: 'Media', icon: 'ellipsis' },
  BAJA: { label: 'Baja', icon: 'trending-down' },
};

export const TASK_PRIORITY_KEYS = Object.keys(TASK_PRIORITIES) as AgendaTaskPriority[];

export const TASK_STATUSES: Record<AgendaTaskStatus, { label: string; icon: string }> = {
  PENDIENTE: { label: 'Pendiente', icon: 'clock' },
  EN_CURSO: { label: 'En curso', icon: 'refresh' },
  EN_ESPERA: { label: 'En espera', icon: 'clock' },
  COMPLETADA: { label: 'Completada', icon: 'check' },
  CANCELADA: { label: 'Cancelada', icon: 'x' },
};

export const TASK_STATUS_KEYS = Object.keys(TASK_STATUSES) as AgendaTaskStatus[];

export const LINK_TYPES: Record<AgendaLinkType, { label: string; icon: string }> = {
  issue: { label: 'Incidencia', icon: 'exclamation' },
  meeting: { label: 'Junta', icon: 'users' },
  supplier: { label: 'Proveedor', icon: 'store' },
  document: { label: 'Documento', icon: 'file-text' },
};

export const LINK_TYPE_KEYS = Object.keys(LINK_TYPES) as AgendaLinkType[];

/** Minutos de antelación ofrecidos tal cual; el resto se trata como "personalizado". */
export const REMINDER_PRESETS: { value: number | null; label: string }[] = [
  { value: null, label: 'Sin recordatorio' },
  { value: 0, label: 'En el momento' },
  { value: 5, label: '5 minutos antes' },
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 1440, label: '1 día antes' },
];

export const RECURRENCE_UNITS: Record<AgendaRecurrenceFreq, { singular: string; plural: string }> = {
  DAILY: { singular: 'día', plural: 'días' },
  WEEKLY: { singular: 'semana', plural: 'semanas' },
  MONTHLY: { singular: 'mes', plural: 'meses' },
  YEARLY: { singular: 'año', plural: 'años' },
};
