/**
 * Siniestro de seguro de una incidencia (`GET /issues/:id/insurance-claims`). El backend devuelve el estado guardado y la
 * etapa DERIVADA (de la espera a la aseguradora y de si un profesional enviado por ella está asignado): aquí solo se
 * les pone nombre. Lo que toca hacer a continuación no es del siniestro: es una tarea, una espera o una visita.
 */
export const CLAIM_STATUSES = ['open', 'under_assessment', 'accepted', 'rejected', 'withdrawn', 'closed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type ClaimStage =
  | 'awaiting_insurer'
  | 'awaiting_professional'
  | 'professional_assigned'
  | 'assessment'
  | 'rejected'
  | 'withdrawn'
  | 'closed';

export interface InsuranceClaimView {
  id: string;
  insurerName: string;
  insurerSupplierId: string | null;
  contractId: string | null;
  policyNumber: string | null;
  reference: string | null;
  status: ClaimStatus;
  stage: ClaimStage;
  openedAt: string;
  closedAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  professional: { assignmentId: string; supplierId: string | null; name: string; phone: string | null } | null;
  waiting: { since: string; dueAt: string | null } | null;
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'Abierto',
  under_assessment: 'En peritación',
  accepted: 'Cobertura aceptada',
  rejected: 'Cobertura rechazada',
  withdrawn: 'Desistido',
  closed: 'Cerrado',
};

export const CLAIM_STAGE_LABEL: Record<ClaimStage, string> = {
  awaiting_insurer: 'Esperando a la aseguradora',
  awaiting_professional: 'Esperando asignación de profesional',
  professional_assigned: 'Profesional asignado',
  assessment: 'En peritación',
  rejected: 'Cobertura rechazada',
  withdrawn: 'Desistido',
  closed: 'Cerrado',
};

/** Solo estos dos son definitivos; un rechazo se puede reconsiderar. */
export const isTerminalClaim = (status: string): boolean => status === 'withdrawn' || status === 'closed';
export const isLiveClaim = (claim: Pick<InsuranceClaimView, 'status'>): boolean => !isTerminalClaim(claim.status);

export const isClaimStatus = (value: unknown): value is ClaimStatus =>
  typeof value === 'string' && (CLAIM_STATUSES as readonly string[]).includes(value);

/**
 * El backend rechaza cerrar una incidencia con un siniestro no terminal (409 con este código). Resuelta sí se admite: el
 * problema está solucionado aunque el expediente con la aseguradora siga abierto.
 */
export const ISSUE_HAS_OPEN_CLAIM_CODE = 'ISSUE_HAS_OPEN_INSURANCE_CLAIM';
export const CLOSE_BLOCKED_BY_CLAIM_MESSAGE =
  'No puedes cerrar esta incidencia porque todavía tiene un siniestro abierto. Puedes dejarla como Resuelta y cerrar la incidencia cuando finalice la gestión con la aseguradora.';
export const isCloseBlockedByClaim = (error: unknown): boolean =>
  (error as { error?: { code?: string } } | null)?.error?.code === ISSUE_HAS_OPEN_CLAIM_CODE;

/** Cerrar también se rechaza (409) mientras esté por decidir la comunicación de «resuelta» al solicitante (tarea «Informar al solicitante»). */
export const ISSUE_HAS_PENDING_NOTICE_CODE = 'ISSUE_HAS_PENDING_REQUESTER_NOTICE';
export const CLOSE_BLOCKED_BY_NOTICE_MESSAGE =
  'Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante: envíala o descártala desde Tareas.';
export const CLOSE_BLOCKED_BY_CLAIM_AND_NOTICE_MESSAGE =
  'Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante y la gestión del siniestro de seguro que sigue abierto.';

/**
 * El texto humano de un cierre rechazado por el servidor (nunca el código técnico), o `null` si el error no es de ese tipo.
 * Con los dos bloqueos a la vez el servidor responde una sola vez y `blockers` los lista: aquí se dicen juntos.
 */
export const closeBlockedMessage = (error: unknown): string | null => {
  const body = (error as { error?: { code?: string; blockers?: string[] } } | null)?.error;
  const codes = Array.isArray(body?.blockers) ? body.blockers : body?.code ? [body.code] : [];
  const claim = codes.includes(ISSUE_HAS_OPEN_CLAIM_CODE);
  const notice = codes.includes(ISSUE_HAS_PENDING_NOTICE_CODE);
  if (claim && notice) return CLOSE_BLOCKED_BY_CLAIM_AND_NOTICE_MESSAGE;
  if (notice) return CLOSE_BLOCKED_BY_NOTICE_MESSAGE;
  return claim ? CLOSE_BLOCKED_BY_CLAIM_MESSAGE : null;
};

/** Vías de gestión que implican un seguro: con ellas (o con algún siniestro) el expediente enseña el bloque «Seguro». */
export const INSURANCE_ROUTES = ['community_insurance', 'owner_insurance'] as const;
export const isInsuranceRoute = (route: string | null | undefined): boolean =>
  !!route && (INSURANCE_ROUTES as readonly string[]).includes(route);
