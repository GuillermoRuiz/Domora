import type { WaitParty } from '../prisma/client';
import type { ResolutionRoute } from './resolution-routes';
import type { IssueTaskKind } from './task-kinds/issue-task-definitions';

/**
 * QUÉ TRABAJO QUEDA INVALIDADO cuando una persona cambia la vía de gestión. La vía (`Issue.resolutionRoute`) es
 * autoritativa: cada una activa UNA rama del workflow y todo lo que cuelga de otra rama deja de tener sentido. Este
 * módulo es la única fuente de esa tabla (puro, sin base de datos); `IssueWorkflowService.reconcileRouteChange` la aplica.
 */

/** Las ramas del workflow: a quién se gestiona la incidencia. */
export type RouteBranch = 'provider' | 'insurer' | 'owner';

const BRANCHES_OF_ROUTE: Record<ResolutionRoute, readonly RouteBranch[]> = {
  community_provider: ['provider'],
  // El profesional que envía la aseguradora forma parte de esta rama (ver `isClaimProfessionalWait`).
  community_insurance: ['insurer'],
  owner_insurance: ['owner'],
  direct_management: [],
};

/** Ramas activas con esta vía. Sin vía decidida (`null`) ninguna rama automática está activa. */
export function branchesOfRoute(
  route: ResolutionRoute | null,
): readonly RouteBranch[] {
  return route ? BRANCHES_OF_ROUTE[route] : [];
}

/** Rama a la que pertenece una espera según a quién se espera. `other` no pertenece a ninguna. */
const WAIT_PARTY_BRANCH: Partial<Record<WaitParty, RouteBranch>> = {
  provider: 'provider',
  insurer: 'insurer',
  owner: 'owner',
};

/** Motivos de `review_issue` que pide cada rama (su discriminador). */
export const BRANCH_REVIEW_REASONS: Record<RouteBranch, readonly string[]> = {
  provider: ['missing_provider', 'notify_only', 'contact_provider'],
  insurer: ['open_insurance_claim', 'claim_rejected'],
  owner: ['ask_owner_file_claim'],
};

/**
 * Las tareas «Revisar incidencia nueva» (según por qué se gestiona a mano): su decisión es la vía de gestión. Se
 * sustituyen cuando hay constancia de que la gestión ya avanzó (ver `IssueWorkflowService.settleEntryReview`).
 */
export const ENTRY_REVIEW_REASONS = ['new_issue'] as const;

/**
 * Tareas que una vía abre ELLA misma como su siguiente paso humano. Mientras exista una, la revisión de entrada («Revisar
 * incidencia nueva») sobra: la vía ya está decidida y lo que queda por hacer es esto.
 */
export const ROUTE_OWNED_REVIEW_REASONS = [
  'open_insurance_claim',
  'ask_owner_file_claim',
  'direct_management',
  'contact_provider',
] as const;

/** Las que además se dan por atendidas cuando una persona actúa y la incidencia queda con otro paso real. */
export const PERSON_SETTLED_ROUTE_REASONS = [
  'direct_management',
  'contact_provider',
] as const;

/** Motivo (y discriminador) de la tarea que deja la vía «Administrador» con una persona al mando. */
export const DIRECT_MANAGEMENT_REASON = 'direct_management';

/** Motivo (y discriminador) de la ÚNICA tarea «Revisar actualización del solicitante» que puede haber abierta por incidencia. */
export const REQUESTER_UPDATE_REASON = 'requester_update';

/** Plantilla del aviso de resolución al solicitante: la tarea que lo propone se identifica por ella. */
export const RESOLVED_NOTICE_TEMPLATE = 'issue_resolved';

/** ¿Es la tarea de revisar una novedad del solicitante? */
export const isRequesterUpdateTask = (t: {
  kind: string | null;
  payload?: unknown;
}): boolean =>
  t.kind === 'review_issue' &&
  (t.payload as { reason?: string } | null)?.reason === REQUESTER_UPDATE_REASON;

/**
 * Tareas que son información o comunicación, no un paso que haga avanzar la incidencia: avisar al solicitante y leer su
 * novedad. No cuentan como «siguiente paso» (`hasNextStep`), aunque sigan siendo trabajo humano vivo.
 */
export const isInformationalTask = (t: {
  kind: string | null;
  payload?: unknown;
}): boolean => t.kind === 'inform_requester' || isRequesterUpdateTask(t);

/**
 * ¿Pertenece esta tarea viva a la vía vigente? Una tarea de una rama que la vía no activa (aprobar el envío al proveedor con
 * la vía del seguro, abrir el siniestro con la del proveedor…) es trabajo de la vía anterior: `reconcileRouteChange` la
 * sustituye, y mientras tanto no cuenta como siguiente paso. Las demás (seguimientos, decisiones sueltas) valen con cualquier vía.
 */
export function taskCompatibleWithRoute(
  task: { kind: string | null; payload?: unknown },
  route: ResolutionRoute | null,
): boolean {
  const allowed = branchesOfRoute(route);
  if (task.kind !== 'review_issue') return true;
  const reason = (task.payload as { reason?: string } | null)?.reason ?? '';
  if (reason === DIRECT_MANAGEMENT_REASON) return route === 'direct_management';
  for (const branch of ['provider', 'insurer', 'owner'] as const)
    if (BRANCH_REVIEW_REASONS[branch].includes(reason))
      return allowed.includes(branch);
  return true;
}

export interface WaitFacts {
  party: WaitParty;
  refType: string | null;
  supplierId: string | null;
  partyLabel: string | null;
}

/** Los profesionales que envió la aseguradora por un siniestro (asignaciones vigentes con `claimId`). */
export interface ClaimProfessionals {
  supplierIds: ReadonlySet<string>;
  names: ReadonlySet<string>;
}

export const normalizeName = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** ¿Es la espera a un profesional enviado por la aseguradora? Entonces pertenece a la rama del seguro, no a la del proveedor. */
export function isClaimProfessionalWait(
  wait: WaitFacts,
  professionals: ClaimProfessionals,
): boolean {
  if (wait.party !== 'provider') return false;
  if (wait.supplierId) return professionals.supplierIds.has(wait.supplierId);
  return professionals.names.has(normalizeName(wait.partyLabel));
}

/**
 * ¿Deja de corresponder esta espera al pasar de `from` a `to`?
 *  - Sin vía nueva (`to = null`) no se cierra ninguna espera: la persona decide qué hacer con lo que estaba esperando.
 *  - Una espera registrada por una PERSONA solo se cierra si pertenecía a la rama de la vía anterior.
 */
export function waitObsoleteOnChange(
  wait: WaitFacts,
  change: { from: ResolutionRoute | null; to: ResolutionRoute | null },
  professionals: ClaimProfessionals,
): boolean {
  const branch = WAIT_PARTY_BRANCH[wait.party];
  if (!branch || change.to === null) return false;
  const allowed = branchesOfRoute(change.to);
  if (allowed.includes(branch)) return false;
  if (
    isClaimProfessionalWait(wait, professionals) &&
    allowed.includes('insurer')
  )
    return false;
  return change.from !== null && branchesOfRoute(change.from).includes(branch);
}
