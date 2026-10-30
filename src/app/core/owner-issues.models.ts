/**
 * «Incidencias» del propietario (rol C): las formas que devuelve `/me/issues`
 * (backend/src/issues/owner-issues.service.ts). Una incidencia es de la COMUNIDAD (`estateId`): nunca de una vivienda ni
 * con ámbito privado. Los valores de los enums viajan como los envía la API (identificadores de Prisma); las etiquetas
 * de abajo son para mostrar.
 */

export type OwnerIssueStatus =
  | 'Abierta'
  | 'EnReparacion'
  | 'PendienteProveedor'
  | 'PendienteInformacion'
  | 'Resuelta'
  | 'Cerrada'
  | 'Retirada';
/** Tipo de incidencia. */
export type OwnerIssueSubtype = 'Averia' | 'Ruido' | 'DanoEstructural' | 'Fuga' | 'Seguridad' | 'Limpieza' | 'Otro';
export type OwnerIssuePriority = 'Normal' | 'Urgente';

export interface OwnerIssueListItem {
  id: string;
  ref: string;
  title: string;
  description: string;
  type: OwnerIssueSubtype;
  /** Zona o instalación afectada, como la indicó quien avisó. */
  location: string | null;
  status: OwnerIssueStatus;
  priority: OwnerIssuePriority;
  date: string;
  /** La comunidad de la incidencia y su nombre (útil en «Todas»). */
  estateId: string;
  estateName: string;
  /** ¿La reportaste tú? (existe un aviso tuyo). Solo quien la reportó actúa sobre ella. */
  mine: boolean;
  /** La gestión pidió información y la espera de ti. */
  awaitingMyAnswer: boolean;
  affectedCount: number;
  affectedByMe: boolean;
}

export interface OwnerIssueKpis {
  open: number;
  inProgress: number;
  resolved: number;
}

export interface OwnerIssueList {
  items: OwnerIssueListItem[];
  kpis: OwnerIssueKpis;
}

export interface OwnerIssueAttachment {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  uploadedAt: string;
}

export interface OwnerIssueTimelineEntry {
  id: string;
  date: string;
  /** Qué ocurrió (`status_changed`, `note`, `info_requested`…). */
  kind: string;
  role: string;
  /** «Tú», «Un vecino» o «Administración»: nunca el nombre de un vecino. */
  author: string;
  text: string;
  fromStatus: OwnerIssueStatus | null;
  toStatus: OwnerIssueStatus | null;
}

export interface OwnerIssueDetail extends OwnerIssueListItem {
  createdAt: string;
  resolvedAt: string | null;
  attachments: OwnerIssueAttachment[];
  timeline: OwnerIssueTimelineEntry[];
  rating: number | null;
  ratingComment: string | null;
  expectedResponseHours: number;
  canReply: boolean;
  canWithdraw: boolean;
  /** Otros vecinos también la reportaron o les afecta: no se puede retirar desde aquí. */
  withdrawBlockedByOthers: boolean;
  canReopen: boolean;
  canRate: boolean;
  canMarkAffected: boolean;
}

/** Una zona o instalación de la comunidad donde puede ocurrir (nunca la vivienda de quien avisa). */
export interface OwnerIssueLocation {
  label: string;
}

export interface SimilarIssue {
  id: string;
  title: string;
  status: OwnerIssueStatus;
  location: string | null;
  mine: boolean;
  affectedCount: number;
  affectedByMe: boolean;
}

export interface OwnerIssueQuery {
  /** Una comunidad; sin ella, todas las del propietario. */
  estateId?: string;
  q?: string;
  status?: OwnerIssueStatus[];
}

export interface CreateOwnerIssueInput {
  /** La comunidad en la que se avisa. */
  estateId: string;
  type?: OwnerIssueSubtype;
  title: string;
  description: string;
  location: string;
  urgent: boolean;
}

// ── Display ───────────────────────────────────────────────────────────

export const OWNER_ISSUE_SUBTYPES: { value: OwnerIssueSubtype; label: string }[] = [
  { value: 'Averia', label: 'Avería' },
  { value: 'Ruido', label: 'Ruido' },
  { value: 'DanoEstructural', label: 'Daño estructural' },
  { value: 'Fuga', label: 'Fuga' },
  { value: 'Seguridad', label: 'Seguridad' },
  { value: 'Limpieza', label: 'Limpieza' },
  { value: 'Otro', label: 'Otro' },
];

export type OwnerIssueTone = 'danger' | 'info' | 'warning' | 'positive' | 'neutral';

/** Owners never see provider details: both in-progress states read «En curso». */
export const OWNER_ISSUE_STATUS: Record<OwnerIssueStatus, { label: string; tone: OwnerIssueTone }> = {
  Abierta: { label: 'Abierta', tone: 'danger' },
  EnReparacion: { label: 'En curso', tone: 'info' },
  PendienteProveedor: { label: 'En curso', tone: 'info' },
  PendienteInformacion: { label: 'Pendiente de información', tone: 'warning' },
  Resuelta: { label: 'Resuelta', tone: 'positive' },
  Cerrada: { label: 'Cerrada', tone: 'positive' },
  Retirada: { label: 'Retirada', tone: 'neutral' },
};

/** Statuses after which nothing else is expected from the manager. */
export const OWNER_ISSUE_FINAL_STATUSES: OwnerIssueStatus[] = ['Resuelta', 'Cerrada', 'Retirada'];
