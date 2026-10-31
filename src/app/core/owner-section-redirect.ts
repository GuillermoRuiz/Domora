import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { OwnerScopeService } from './owner-scope.service';
import { OWNER_HOME, OWNER_MEETINGS_ROUTE, OWNER_RECEIPTS_ROUTE, ownerPropertyCommands } from './owner-routes';

/**
 * Avisos y enlaces que nombran una sección sin propiedad: `/c/community?tab=<sección>` (y los antiguos
 * `/c/properties?tab=…`, que redirigen aquí conservando la query).
 * - `receipts` y `juntas` tienen su módulo (con `propertyId` o `estateId` si los traen).
 * - `communications` y `reservas` son pestañas de la ficha: se abre la propiedad indicada, la primera del
 *   propietario en esa finca (`estateId`), la elegida o la primera que tenga.
 */
export const ownerCommunitySectionRedirect: CanActivateFn = async (route) => {
  const params = route.queryParamMap;
  const tab = params.get('tab');
  const propertyId = params.get('propertyId');
  const estateId = params.get('estateId');
  const router = inject(Router);

  if (tab === 'receipts') {
    return router.createUrlTree([OWNER_RECEIPTS_ROUTE], { queryParams: propertyId ? { propertyId } : {} });
  }
  if (tab === 'juntas') {
    return router.createUrlTree([OWNER_MEETINGS_ROUTE], { queryParams: propertyId ? { propertyId } : estateId ? { estateId } : {} });
  }
  if (tab !== 'communications' && tab !== 'reservas') return true;

  const scope = inject(OwnerScopeService);
  if (!scope.loaded()) await scope.load();
  const items = scope.items();
  const property =
    items.find((p) => p.id === propertyId) ??
    items.find((p) => !!estateId && p.estateId === estateId) ??
    scope.selected() ??
    items[0];
  if (!property) return router.createUrlTree([OWNER_HOME]);
  return router.createUrlTree(ownerPropertyCommands(property.id), { queryParams: { tab } });
};
