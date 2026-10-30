/**
 * Enlaces del portal del propietario (rol C) que llevan las notificaciones.
 * Espejo de `src/app/core/owner-routes.ts`: si una ruta cambia allí, cambia aquí.
 */

/** Inicio del propietario: «Mi comunidad». */
export const OWNER_HOME_LINK = '/c/community';

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
