import type { IssueStatus } from '../prisma/client';

/** Estados que cuentan como "necesita atención" — usado para badges/alertas. */
export const ACTIVE_ISSUE_STATUSES: IssueStatus[] = [
  'Abierta',
  'EnReparacion',
  'PendienteProveedor',
  // Se espera la respuesta de quien avisó: sigue sin resolverse.
  'PendienteInformacion',
];

/**
 * Estados que significan «se resolvió». `Retirada` es terminal pero NO es una resolución: no cuenta como resuelta, ni en tiempos de
 * resolución, ni en las métricas de proveedores. Quien necesite «ya no hay nada que hacer» usa `isTerminalIssueStatus`.
 */
export const RESOLVED_ISSUE_STATUSES: IssueStatus[] = ['Resuelta', 'Cerrada'];

/** Estados que solo la propia gestión pone a mano: `PendienteInformacion` (pedir información) y `Retirada` (la retira quien avisó). */
export const MANAGED_ELSEWHERE_STATUSES: IssueStatus[] = [
  'PendienteInformacion',
  'Retirada',
];

/**
 * Código estable (409) de «Cerrada» rechazada porque aún está por decidir la comunicación de «resuelta» al solicitante (la tarea
 * «Informar al solicitante» sigue abierta). Se resuelve enviándola o descartándola; cerrar no la cancela en silencio. Convive con
 * `ISSUE_HAS_OPEN_INSURANCE_CLAIM` (siniestro vivo) en la misma respuesta (`blockers`).
 */
export const ISSUE_HAS_PENDING_REQUESTER_NOTICE =
  'ISSUE_HAS_PENDING_REQUESTER_NOTICE';

/**
 * Tres preguntas distintas que antes se respondían con «terminal»:
 *  - `isOperationallyActive`: ¿hay trabajo operativo ordinario (tareas, esperas, visitas, jobs)? Solo Abierta, En reparación,
 *    Pendiente proveedor y Pendiente de información.
 *  - `allowsPostResolutionWork`: ¿admite el trabajo administrativo POSTERIOR a resolver (avisar al solicitante, su valoración,
 *    la ventana de reapertura)? Solo `Resuelta`. Es una excepción EXPLÍCITA: quien la usa lo declara (`afterSettlement`).
 *  - `isFullyClosed`: ¿terminó el expediente y no puede generar ningún trabajo? `Cerrada` y `Retirada`.
 * `Resuelta` no es operativamente activa ni cerrada del todo: el problema está solucionado pero queda papeleo.
 */
export const isOperationallyActive = (status: IssueStatus): boolean =>
  ACTIVE_ISSUE_STATUSES.includes(status);
export const allowsPostResolutionWork = (status: IssueStatus): boolean =>
  status === 'Resuelta';
export const isFullyClosed = (status: IssueStatus): boolean =>
  status === 'Cerrada' || status === 'Retirada';
