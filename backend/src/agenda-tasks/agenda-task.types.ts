import type {
  AgendaLinkType,
  AgendaRecurrenceFreq,
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
  TaskCreatorKind,
} from '../prisma/client';

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface LabelRef {
  id: string;
  name: string;
}

/**
 * Tarea tal y como se sirve al calendario. Si la tarea es una serie, cada
 * ocurrencia es un elemento distinto (`occurrenceKey`); `startAt`/`endAt` son
 * siempre los de la SERIE y `occurrenceStart`/`occurrenceEnd` los de esta
 * ocurrencia. `status` ya incorpora la resolución individual de la ocurrencia.
 */
export interface AgendaTaskView {
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
  overdue: boolean;
  allDay: boolean;
  noDuration: boolean;
  timezone: string;
  startAt: string;
  endAt: string;
  /** Fecha límite propia (`null` = vence al acabar su bloque). Independiente de `startAt`/`endAt`: mover la tarea no la cambia. */
  dueAt: string | null;
  reminderMinutesBefore: number | null;
  recurrence: {
    freq: AgendaRecurrenceFreq;
    interval: number;
    until: string | null;
  } | null;
  labels: LabelRef[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  attachmentCount: number;
  linkCount: number;
  source: string;
  /** Null en las tareas que abre Domora: ver `createdByKind`. */
  createdByUserId: string | null;
  createdByKind: TaskCreatorKind;
  /** Incidencia de la que nace (solo las tareas de decisión humana que abre Domora). */
  issueId: string | null;
  /** Tipo de acción humana; null en las tareas manuales. */
  kind: string | null;
}

export interface LinkedEntityView {
  type: AgendaLinkType;
  id: string;
  /** Texto para mostrar: "INC-482 · Avería ascensor", nombre del proveedor… */
  label: string;
  estateId: string;
  /** Ruta del frontend donde se abre la entidad (vacía si ya no existe). */
  route: string;
  /**
   * La entidad ya no existe (o está en la papelera): el vínculo se conserva como historia, con el título que tenía al vincularla.
   * `false` en los vínculos vivos.
   */
  deleted: boolean;
}

export interface AgendaTaskDetail extends AgendaTaskView {
  /** Solo en el detalle: el calendario no necesita (ni debe cargar) el texto largo. */
  description: string | null;
  createdBy: PersonRef | null;
  /** Datos de la decisión (validados por `kind`) y cómo se resolvió. */
  payload: unknown;
  outcome: string | null;
  resultRef: unknown;
  createdAt: string;
  updatedAt: string;
  checklist: { id: string; text: string; done: boolean; position: number }[];
  comments: {
    id: string;
    text: string;
    createdAt: string;
    author: PersonRef | null;
  }[];
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  links: LinkedEntityView[];
}

/** Resultado de una consulta de tareas; `truncated` avisa de que se alcanzó un tope de seguridad. */
export interface AgendaTaskList {
  items: AgendaTaskView[];
  truncated: boolean;
}

export interface AgendaSummary {
  today: number;
  week: number;
  urgent: number;
  overdue: number;
}
