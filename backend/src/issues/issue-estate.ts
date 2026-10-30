import type { Prisma } from '../prisma/client';
import { ownerIssueLink } from '../common/owner-links';

/**
 * La finca de una incidencia es `Issue.estateId` (obligatoria): una incidencia es siempre de la comunidad, nunca de una vivienda.
 * Todo lo que filtra, agrupa o autoriza incidencias por finca pasa por aquí.
 */

/** Las incidencias de una finca (o de varias). */
export function issuesOfEstate(
  estateIds: string | readonly string[],
): Prisma.IssueWhereInput {
  return {
    estateId:
      typeof estateIds === 'string' ? estateIds : { in: [...estateIds] },
  };
}

/** A dónde lleva, en el portal del propietario, un aviso sobre la incidencia: a su módulo de Incidencias, abierta en esa incidencia. */
export function issuePortalLink(issueId: string): string {
  return ownerIssueLink(issueId);
}
