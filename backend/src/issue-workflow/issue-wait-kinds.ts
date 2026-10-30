import type { WaitParty } from '../prisma/client';

/**
 * Qué puede estar esperando un expediente fuera de Domora (`IssueWait.kind`).
 * Varchar abierto: un tipo nuevo se añade aquí, sin migración. Una visita ya
 * programada NO es una espera: es `SupplierVisit`. Esperar a la administración
 * tampoco: si hay trabajo humano, es una `AgendaTask`.
 */
export const ISSUE_WAIT_KINDS = [
  'provider_reply',
  'insurer_reply',
  'owner_reply',
  'owner_confirmation',
  'other_reply',
] as const;
export type IssueWaitKind = (typeof ISSUE_WAIT_KINDS)[number];

/** A quién espera cada tipo de espera. */
export const WAIT_KIND_PARTY: Record<IssueWaitKind, WaitParty> = {
  provider_reply: 'provider',
  insurer_reply: 'insurer',
  owner_reply: 'owner',
  owner_confirmation: 'owner',
  other_reply: 'other',
};

export const isWaitKind = (value: string): value is IssueWaitKind =>
  (ISSUE_WAIT_KINDS as readonly string[]).includes(value);

/** Tipo de espera por defecto cuando solo se sabe a quién se espera (una revisión que se resuelve esperando a un tercero). */
export const WAIT_KIND_FOR_PARTY: Record<WaitParty, IssueWaitKind> = {
  provider: 'provider_reply',
  insurer: 'insurer_reply',
  owner: 'owner_reply',
  other: 'other_reply',
};
