import { ConflictException } from '@nestjs/common';
import type { IssueStatus } from '../prisma/client';

/** Código estable (409) de un cambio de estado manual que el dominio no admite. */
export const ISSUE_STATUS_TRANSITION_NOT_ALLOWED =
  'ISSUE_STATUS_TRANSITION_NOT_ALLOWED';

const WORKING: IssueStatus[] = ['Abierta', 'EnReparacion', 'PendienteProveedor'];

/**
 * Matriz MÍNIMA de cambios de estado a mano (`PATCH :id/status` y «resolver» al registrar una interacción). No es una máquina de
 * estados rígida: solo descarta lo incoherente, y las transiciones con efectos propios tienen su operación de dominio.
 *
 *  - de un estado de trabajo (o de «Pendiente de información») se va a cualquier estado de trabajo, a Resuelta o a Cerrada;
 *  - Resuelta se puede cerrar o reabrir (a un estado de trabajo: `settleIssueLifecycle`/`supersedeResolvedNotice` lo cubren);
 *  - Cerrada solo vuelve a Resuelta o se reabre como `Abierta` (nunca salta a «Pendiente proveedor» o «En reparación»: eso
 *    exige un proveedor o una reparación que el expediente cerrado ya no tiene);
 *  - Retirada solo se reabre como `Abierta` (la reapertura de quien avisó pasa por su propio flujo; la gestión también puede).
 *
 * Pedir información, retirar y la reapertura del solicitante NO pasan por aquí: tienen sus operaciones (`requestInfo`,
 * `withdraw`, `reopen`) y fijan `statusBeforeInfoRequest` o el rastro que necesitan.
 */
export const MANUAL_ISSUE_TRANSITIONS: Readonly<
  Record<IssueStatus, readonly IssueStatus[]>
> = {
  Abierta: [...WORKING, 'Resuelta', 'Cerrada'],
  EnReparacion: [...WORKING, 'Resuelta', 'Cerrada'],
  PendienteProveedor: [...WORKING, 'Resuelta', 'Cerrada'],
  PendienteInformacion: [...WORKING, 'Resuelta', 'Cerrada'],
  Resuelta: [...WORKING, 'Cerrada'],
  Cerrada: ['Abierta', 'Resuelta'],
  Retirada: ['Abierta'],
};

export function canTransitionManually(
  from: IssueStatus,
  to: IssueStatus,
): boolean {
  return from === to || MANUAL_ISSUE_TRANSITIONS[from].includes(to);
}

export function assertManualTransition(
  from: IssueStatus,
  to: IssueStatus,
): void {
  if (canTransitionManually(from, to)) return;
  throw new ConflictException({
    code: ISSUE_STATUS_TRANSITION_NOT_ALLOWED,
    from,
    to,
    message: `No se puede pasar una incidencia de «${from}» a «${to}» a mano. Reábrela (Abierta) y gestiónala desde ahí.`,
  });
}
