import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

/**
 * Guard de tenant.
 *
 * Se ejecuta antes de activar rutas que apuntan a una entidad raíz (finca,
 * contabilidad de finca…) y verifica que el `:id` de la URL pertenece al tenant
 * activo (según estateIds del JWT). Si NO pertenece, redirige a la lista
 * correspondiente y muestra una advertencia en consola.
 *
 * Esto es la primera línea de defensa contra cross-tenant access por URL
 * manipulada. La verdadera defensa vive server-side (EstateScopeGuard).
 */
export const tenantEstateGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const tenant = inject(TenantContextService);

  const id = route.paramMap.get('id');
  if (!id) return true;

  if (!tenant.canAccessEstate(id)) {
    console.warn(`[tenantEstateGuard] Acceso denegado a la finca ${id} — pertenece a otro tenant.`);
    return router.createUrlTree(['/b/estates']);
  }
  return true;
};

export const tenantAccountingGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const tenant = inject(TenantContextService);

  const id = route.paramMap.get('id');
  if (!id) return true;

  if (!tenant.canAccessEstate(id)) {
    console.warn(`[tenantAccountingGuard] Acceso denegado a la contabilidad ${id} — pertenece a otro tenant.`);
    return router.createUrlTree(['/b/accounting']);
  }
  return true;
};
