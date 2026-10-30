/**
 * Vía por la que se gestiona una incidencia (`Issue.resolutionRoute`). Catálogo validado en código: añadir una
 * vía no necesita migración. `null` en la incidencia = todavía sin decidir (no hay un valor «undecided»).
 */
export const RESOLUTION_ROUTES = [
  'community_provider',
  'community_insurance',
  'owner_insurance',
  'direct_management',
] as const;
export type ResolutionRoute = (typeof RESOLUTION_ROUTES)[number];

export const ROUTE_LABELS: Record<ResolutionRoute, string> = {
  community_provider: 'Proveedor (sin seguro)',
  community_insurance: 'Seguro de la comunidad',
  owner_insurance: 'Seguro del propietario',
  direct_management: 'Administrador',
};

export const isResolutionRoute = (value: unknown): value is ResolutionRoute =>
  typeof value === 'string' &&
  (RESOLUTION_ROUTES as readonly string[]).includes(value);
