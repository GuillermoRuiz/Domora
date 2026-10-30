/**
 * Enlaces del portal del propietario (rol C) que llevan las notificaciones.
 * Espejo de `src/app/core/owner-routes.ts`: si una ruta cambia allí, cambia aquí.
 */

/** Inicio del propietario: «Mi comunidad». */
export const OWNER_HOME_LINK = '/c/community';
export const OWNER_MESSAGES_LINK = '/c/messages';
/** Feed de Alertas: para avisos sin pantalla propia (p. ej. inspecciones). */
export const OWNER_ALERTS_LINK = '/c/alerts';

/**
 * Las rutas del portal a las que puede llevar un aviso. El test de contrato comprueba que ningún
 * otro fichero escribe un enlace `/c/…` a mano.
 */
export const OWNER_LINK_ROUTES = [
  '/c/community',
  '/c/properties',
  '/c/incidencias',
  '/c/documentacion',
  '/c/juntas',
  '/c/recibos',
  '/c/messages',
  '/c/alerts',
] as const;

function withQuery(
  path: string,
  query: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Ficha de una propiedad, opcionalmente en una de sus pestañas. */
export function ownerPropertyLink(
  propertyId: string,
  tab?: 'communications' | 'reservas',
): string {
  return withQuery(`/c/properties/${propertyId}`, { tab });
}

/** Módulo de Recibos, en la propiedad del recibo y con ese recibo abierto. */
export function ownerReceiptsLink(
  propertyId: string,
  receiptId?: string | null,
): string {
  return withQuery('/c/recibos', { propertyId, receipt: receiptId });
}

/** Módulo de Juntas, en la comunidad de la junta y con esa junta abierta. */
export function ownerMeetingsLink(
  estateId: string,
  meetingId?: string | null,
): string {
  return withQuery('/c/juntas', { estateId, meeting: meetingId });
}

/**
 * Una pestaña de la ficha cuando el aviso es de la comunidad y no de una propiedad:
 * `/c/community` elige la primera propiedad del propietario en esa finca.
 */
export function ownerEstateSectionLink(
  estateId: string,
  tab: 'communications' | 'reservas',
): string {
  return withQuery(OWNER_HOME_LINK, { tab, estateId });
}

/** Módulo de Incidencias, con esa incidencia abierta. */
export function ownerIssueLink(issueId: string): string {
  return withQuery('/c/incidencias', { issue: issueId });
}

/** Documentación, con ese documento abierto (o la página, sin él). */
export function ownerDocumentsLink(documentId?: string | null): string {
  return withQuery('/c/documentacion', { doc: documentId });
}
