import type { IssueStatus } from '../prisma/client';

/** Markers describe the current lifecycle. Reopening clears them; structured
 * timeline events retain every resolution/closure from earlier cycles. */
export function issueStatusDates(from: IssueStatus, to: IssueStatus, now: Date): {
  resolvedAt?: Date | null; closedAt?: Date | null;
} {
  if (from === to) return {};
  if (to === 'Resuelta') return { resolvedAt: now, closedAt: null };
  if (to === 'Cerrada') return { closedAt: now };
  // Retirada es terminal pero NO una resolución: solo `closedAt`, nunca `resolvedAt`.
  if (to === 'Retirada') return { closedAt: now };
  if (from === 'Resuelta' || from === 'Cerrada' || from === 'Retirada') return { resolvedAt: null, closedAt: null };
  return {};
}
