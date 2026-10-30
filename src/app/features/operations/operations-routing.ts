import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../../core/auth.service';

export const operationsRoleGuard: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  if (user?.role === 'B') return true;
  return inject(Router).createUrlTree([
    user?.role === 'A'
      ? '/a/admins'
      : user?.role === 'C'
        ? '/c/properties'
        : '/login',
  ]);
};
/** Preserve existing notification, intelligence and search links after moving the tabs. */
export const legacyEstateOperationsGuard: CanActivateFn = (route) => {
  const id = route.paramMap.get('id');
  const tab = route.queryParamMap.get('tab');
  if (!id || (tab !== 'issues' && tab !== 'juntas')) return true;
  const { tab: ignored, ...query } = route.queryParams;
  const router = inject(Router);
  if (tab === 'juntas')
    return router.createUrlTree(['/b/juntas'], {
      queryParams: { ...query, estateId: id },
    });
  // Una incidencia concreta abre su expediente; sin ella, el listado de Incidencias acotado a la comunidad.
  const { entity, issue, ...rest } = query;
  const target = typeof entity === 'string' && entity ? entity : issue;
  return typeof target === 'string' && target
    ? router.createUrlTree(['/b/incidencias', target])
    : router.createUrlTree(['/b/incidencias'], {
        queryParams: { ...rest, estateId: id },
      });
};
