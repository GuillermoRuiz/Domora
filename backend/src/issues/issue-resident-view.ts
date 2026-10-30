import type {
  IssuePhoto,
  IssueSource,
  IssueStatus,
  IssueTimelineEntry,
  IssueType,
  Priority,
  TimelineAuthorRole,
} from '../prisma/client';
import {
  isVisibleToRequester,
  type IssueEventKind,
} from '../issue-workflow/issue-event-kinds';

/**
 * Lo que un VECINO ve de una incidencia de ZONA COMÚN. Es una LISTA BLANCA, campo a campo: se construye eligiendo lo que sale, nunca
 * quitando lo que no debería (una columna nueva de `Issue` no llega a un vecino por descuido). Una común tiene una audiencia de toda la
 * comunidad, así que no sale nada de la gestión: ni proveedor, siniestro, esperas, tareas, visitas, vía, presupuesto, instalación,
 * avisos enviados, notas internas ni referencias internas (`meta`, `refType`, `refId`, claves de almacenamiento, ids de usuario).
 */

/**
 * Tipos de evento del historial que ven los vecinos en una común: una lista PROPIA, más estricta que la del solicitante de su propia
 * incidencia (no salen los avisos dirigidos al reportante, ni la instalación o el presupuesto).
 */
export const RESIDENT_EVENT_KINDS: ReadonlySet<IssueEventKind> =
  new Set<IssueEventKind>([
    'report_received',
    'status_changed',
    'note',
    'visit_scheduled',
  ]);

/**
 * El aviso que Domora le mandó a QUIEN LA REPORTÓ («Tu incidencia se ha resuelto…»): solo lo ve él, en su historial. Está escrito para
 * los destinatarios (`meta.recipientUserIds`), así que a los demás vecinos no les sale.
 */
function isNoticeToViewer(
  entry: { kind: string; meta: unknown; authorUserId?: string | null },
  viewerId: string,
): boolean {
  // Lo que la gestión pidió a quien avisó y lo que este contestó: solo lo ve esa persona (no el resto de la comunidad).
  if (entry.kind === 'info_provided') return entry.authorUserId === viewerId;
  if (entry.kind !== 'requester_informed' && entry.kind !== 'info_requested')
    return false;
  const meta = (entry.meta ?? {}) as {
    recipientUserId?: unknown;
    recipientUserIds?: unknown;
  };
  const ids = Array.isArray(meta.recipientUserIds)
    ? meta.recipientUserIds
    : [meta.recipientUserId];
  return ids.includes(viewerId);
}

export interface ResidentTimelineEntry {
  id: string;
  date: Date;
  kind: string;
  role: TimelineAuthorRole;
  text: string;
  /** Sin nombres de personas: «Tú», «Un vecino», «Administración» o quien actuó si no fue una persona. */
  author: string;
  fromStatus: IssueStatus | null;
  toStatus: IssueStatus | null;
}

export interface ResidentPhoto {
  id: string;
  issueId: string;
  uploadedAt: Date;
  /** Nunca sale la clave de almacenamiento. */
  s3Key?: undefined;
  url?: undefined;
}

export interface ResidentIssueView {
  id: string;
  ref: string;
  estateId: string;
  type: IssueType;
  /** Zona o instalación afectada, como la indicó quien avisó. */
  location: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  source: IssueSource;
  date: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  /** Valoración de la resolución: solo la ve quien avisó. */
  rating: number | null;
  ratingComment: string | null;
  photos: ResidentPhoto[];
  timeline: ResidentTimelineEntry[];
  /** ¿Es una de las personas que la reportaron? Solo ellas añaden notas y fotos. */
  reportedByMe: boolean;
  // Lo que NO sale (declarado para que el tipo lo diga y nadie lo lea por error): es de la gestión.
  assetId?: undefined;
  asset?: undefined;
  resolutionRoute?: undefined;
  providerAssignments?: undefined;
  notifications?: undefined;
  reports?: undefined;
  budgetAmount?: undefined;
  budgetDescription?: undefined;
  budgetApproved?: undefined;
  ownerName?: undefined;
}

type ResidentIssueSource = {
  id: string;
  ref: string;
  estateId: string;
  type: IssueType;
  location: string | null;
  rating: number | null;
  ratingComment: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  source: IssueSource;
  date: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  photos: IssuePhoto[];
  timeline: (IssueTimelineEntry & {
    authorUser: { fullName: string } | null;
  })[];
};

function authorLabel(entry: IssueTimelineEntry, viewerId: string): string {
  if (entry.role === 'Propietario')
    return entry.authorUserId === viewerId ? 'Tú' : 'Un vecino';
  if (entry.role === 'Administrador') return 'Administración';
  return entry.actorKind === 'ai' ? 'Domora' : 'Sistema';
}

export function presentIssueForResident(
  issue: ResidentIssueSource,
  viewerId: string,
  reportedByMe: boolean,
): ResidentIssueView {
  return {
    id: issue.id,
    ref: issue.ref,
    estateId: issue.estateId,
    type: issue.type,
    location: issue.location,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    source: issue.source,
    date: issue.date,
    createdAt: issue.createdAt,
    resolvedAt: issue.resolvedAt,
    closedAt: issue.closedAt,
    rating: reportedByMe ? issue.rating : null,
    ratingComment: reportedByMe ? issue.ratingComment : null,
    photos: issue.photos.map((p) => ({
      id: p.id,
      issueId: p.issueId,
      uploadedAt: p.uploadedAt,
    })),
    timeline: issue.timeline
      .filter(
        (e) =>
          !e.internal &&
          (RESIDENT_EVENT_KINDS.has(e.kind as IssueEventKind) ||
            isNoticeToViewer(e, viewerId)) &&
          isVisibleToRequester(e.kind as IssueEventKind, e.actorKind),
      )
      .map((e) => ({
        id: e.id,
        date: e.date,
        kind: e.kind,
        role: e.role,
        text: e.text,
        author: authorLabel(e, viewerId),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
      })),
    reportedByMe,
  };
}
