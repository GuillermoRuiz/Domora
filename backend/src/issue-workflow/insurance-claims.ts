/**
 * Catálogo y reglas puras del siniestro de seguro (`InsuranceClaim`). El estado describe SOLO el expediente del
 * seguro, no la situación de la incidencia: quién tiene la pelota, qué se espera o qué toca hacer se deriva de
 * `AgendaTask`, `IssueWait`, `IssueProviderAssignment.claimId` y `SupplierVisit` (ver `claimStage`).
 * Varchar abierto en la base: un estado nuevo se añade aquí, sin migración.
 */
export const CLAIM_STATUSES = [
  'open',
  'under_assessment',
  'accepted',
  'rejected',
  'withdrawn',
  'closed',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: 'Abierto',
  under_assessment: 'En peritación',
  accepted: 'Cobertura aceptada',
  rejected: 'Cobertura rechazada',
  withdrawn: 'Desistido',
  closed: 'Cerrado',
};

/** Solo estos dos son definitivos. Un rechazo se puede recurrir o reconsiderar sobre el mismo expediente. */
export const TERMINAL_CLAIM_STATUSES: readonly ClaimStatus[] = [
  'withdrawn',
  'closed',
];

export const isClaimStatus = (value: unknown): value is ClaimStatus =>
  typeof value === 'string' &&
  (CLAIM_STATUSES as readonly string[]).includes(value);

export const isTerminalClaimStatus = (status: string): boolean =>
  (TERMINAL_CLAIM_STATUSES as readonly string[]).includes(status);

/** Estados de un siniestro vivo (cualquiera no terminal), para consultas. */
export const ACTIVE_CLAIM_STATUSES: ClaimStatus[] = CLAIM_STATUSES.filter(
  (s) => !isTerminalClaimStatus(s),
);

/**
 * Filtro de estado de un siniestro NO terminal. Se deriva de la lista de terminales (no de la de vivos) para que un valor
 * desconocido del varchar abierto cuente como no terminal, igual que `isTerminalClaimStatus`.
 */
export const NON_TERMINAL_CLAIM_STATUS_FILTER = {
  notIn: [...TERMINAL_CLAIM_STATUSES],
};

/**
 * Códigos estables de los 409 que protegen la invariante «Cerrada ⇒ ningún siniestro no terminal». «Resuelta» sí admite un
 * siniestro vivo (el problema está solucionado, el expediente con la aseguradora sigue su curso); «Cerrada», no.
 */
export const ISSUE_HAS_OPEN_INSURANCE_CLAIM = 'ISSUE_HAS_OPEN_INSURANCE_CLAIM';
export const ISSUE_CLOSED_INSURANCE_CLAIM_NOT_ALLOWED =
  'ISSUE_CLOSED_INSURANCE_CLAIM_NOT_ALLOWED';

/** Un siniestro terminal ya no cambia; en cualquier otro caso se puede pasar a cualquier otro estado. */
export function canChangeClaimStatus(from: string, to: ClaimStatus): boolean {
  return from === to || !isTerminalClaimStatus(from);
}

/** Referencia o nombre comparables: sin espacios sobrantes y sin distinguir mayúsculas. */
export const normalizeClaimText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

/** Categorías de proveedor que son aseguradoras (mismo criterio que el catálogo del frontend). */
const INSURANCE_CATEGORY_KEYS = [
  'seguro',
  'seguros',
  'aseguradora',
  'aseguradoras',
  'correduria',
  'corredurias',
];
export function isInsuranceCategory(category: string): boolean {
  const key = category
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return INSURANCE_CATEGORY_KEYS.includes(key);
}

/**
 * Etapa visible del siniestro. Se DERIVA (nunca se guarda) del estado y de si hay un profesional enviado por la
 * aseguradora asignado (`IssueProviderAssignment.claimId`).
 */
export type ClaimStage =
  | 'awaiting_insurer'
  | 'awaiting_professional'
  | 'professional_assigned'
  | 'assessment'
  | 'rejected'
  | 'withdrawn'
  | 'closed';

export function claimStage(input: {
  status: string;
  professionalAssigned: boolean;
}): ClaimStage {
  switch (input.status) {
    case 'closed':
      return 'closed';
    case 'withdrawn':
      return 'withdrawn';
    case 'rejected':
      return 'rejected';
    case 'under_assessment':
      return 'assessment';
    case 'accepted':
      return input.professionalAssigned
        ? 'professional_assigned'
        : 'awaiting_professional';
    default:
      return input.professionalAssigned
        ? 'professional_assigned'
        : 'awaiting_insurer';
  }
}

export const CLAIM_STAGE_LABELS: Record<ClaimStage, string> = {
  awaiting_insurer: 'Esperando a la aseguradora',
  awaiting_professional: 'Esperando asignación de profesional',
  professional_assigned: 'Profesional asignado',
  assessment: 'En peritación',
  rejected: 'Cobertura rechazada',
  withdrawn: 'Desistido',
  closed: 'Cerrado',
};

/** Tipo de referencia de las esperas (`IssueWait.refType`) que pertenecen a un siniestro. */
export const CLAIM_WAIT_REF_TYPE = 'insurance_claim';
