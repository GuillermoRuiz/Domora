import type { ActorKind, TimelineAuthorRole } from '../prisma/client';

/**
 * Catálogo de tipos de evento del expediente (`IssueTimelineEntry.kind`).
 * La columna es un varchar abierto: un tipo nuevo se añade aquí, sin migración.
 */
export const ISSUE_EVENT_KINDS = [
  // Los de siempre
  'note',
  'status_changed',
  'asset_linked',
  'budget_updated',
  // Entrada y comunicación
  'report_received',
  'notification_sent',
  'requester_informed',
  // La gestión pidió información a quien avisó / quien avisó la aportó (solo los reportantes lo ven, no el resto de vecinos).
  'info_requested',
  'info_provided',
  // La notificación de un aviso al solicitante no salió (interno: el aviso en sí consta en su historial como `requester_informed`).
  'requester_notice_failed',
  'provider_assigned',
  'provider_contacted',
  // Cualquier comunicación externa registrada (llamada, WhatsApp, email…): el detalle va en `meta`.
  'communication',
  'provider_chased',
  // Vía de gestión
  'route_decided',
  // Siniestro de seguro (internos: el solicitante solo ve los avisos que se le envían)
  'claim_opened',
  'claim_updated',
  // Citas
  'visit_scheduled',
  'visit_completed',
  'visit_cancelled',
  // La hora de una visita planificada cambió (interno: al solicitante solo le llega el aviso con plantilla, si procede).
  'visit_rescheduled',
  // Workflow: trabajo humano y esperas
  'task_opened',
  'task_resolved',
  'task_cancelled',
  'wait_started',
  'wait_ended',
  'wait_overdue',
  // Hitos del recorrido (internos): la gestión los añade, renombra, asocia a un estado, completa, reabre, mueve o quita.
  'milestone_added',
  'milestone_renamed',
  'milestone_linked',
  'milestone_done',
  'milestone_reopened',
  'milestone_moved',
  'milestone_removed',
  // Una tarea de la incidencia se reabrió tras completarse.
  'task_reopened',
  // La incidencia se borró (interno): lo que se cerró con ella consta en `meta`; sus tareas se archivaron, no se perdieron.
  'issue_deleted',
] as const;

export type IssueEventKind = (typeof ISSUE_EVENT_KINDS)[number];

/**
 * LISTA BLANCA de lo que ve el propietario/solicitante en el historial. Un tipo de evento nuevo es INTERNO
 * por defecto: para que se muestre hay que añadirlo aquí a propósito. Así los resúmenes del modelo, el
 * proveedor propuesto, las decisiones de política o la maquinaria del workflow no se filtran por descuido.
 */
export const REQUESTER_VISIBLE_EVENT_KINDS: ReadonlySet<IssueEventKind> =
  new Set<IssueEventKind>([
    'note',
    'status_changed',
    'asset_linked',
    'budget_updated',
    'report_received',
    'notification_sent',
    'requester_informed',
    'info_requested',
    'info_provided',
    'visit_scheduled',
  ]);

/** ¿Lo ve el solicitante? Una nota escrita por el sistema o la IA nunca: solo las de una persona. */
export function isVisibleToRequester(
  kind: IssueEventKind,
  actorKind: ActorKind,
): boolean {
  if (!REQUESTER_VISIBLE_EVENT_KINDS.has(kind)) return false;
  return !(kind === 'note' && (actorKind === 'ai' || actorKind === 'system'));
}

/** Rol del historial por defecto según quién actuó. */
export function defaultRoleFor(actorKind: ActorKind): TimelineAuthorRole {
  return actorKind === 'person' ? 'Administrador' : 'Sistema';
}

/** Nombre a mostrar cuando el evento no lleva un usuario concreto. */
export function actorLabel(actorKind: ActorKind): string {
  switch (actorKind) {
    case 'ai':
      return 'Domora';
    case 'external':
      return 'Tercero';
    case 'person':
      return 'Usuario eliminado';
    default:
      return 'Sistema';
  }
}
