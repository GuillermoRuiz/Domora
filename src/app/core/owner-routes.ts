/**
 * Rutas del propietario (rol C). Las pantallas, los menús y los guards las toman de aquí
 * en lugar de escribirlas a mano; el servidor tiene su espejo en `backend/src/common/owner-links.ts`.
 */

/** Inicio del propietario: «Mi comunidad». */
export const OWNER_HOME = '/c/community';
export const OWNER_ISSUES_ROUTE = '/c/incidencias';
export const OWNER_DOCUMENTS_ROUTE = '/c/documentacion';
export const OWNER_MEETINGS_ROUTE = '/c/juntas';
export const OWNER_RECEIPTS_ROUTE = '/c/recibos';
export const OWNER_MESSAGES_ROUTE = '/c/messages';
export const OWNER_ACTIVITY_ROUTE = '/c/activity';
export const OWNER_ALERTS_ROUTE = '/c/alerts';
export const OWNER_NOTIFICATIONS_ROUTE = '/c/notifications';
export const OWNER_SETTINGS_ROUTE = '/c/settings';
/** Ficha de una propiedad: `/c/properties/:id`. */
export const OWNER_PROPERTY_ROUTE = '/c/properties';

/** Pestañas de la ficha de una propiedad. Juntas y recibos tienen su propio módulo. */
export type OwnerPropertyTab = 'summary' | 'communications' | 'reservas';
export const OWNER_PROPERTY_TABS: readonly OwnerPropertyTab[] = ['summary', 'communications', 'reservas'];

/** Comandos de router para la ficha de una propiedad. */
export function ownerPropertyCommands(propertyId: string): string[] {
  return [OWNER_PROPERTY_ROUTE, propertyId];
}
