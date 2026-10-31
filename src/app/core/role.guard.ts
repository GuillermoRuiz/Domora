import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { DespachoContextService } from './despacho-context.service';
import { ROLE_HOME } from './role-home';
import { StateService } from './state.service';
import { SupportSessionService } from './support-session.service';
import type { Role } from './models';

/** Query param that asks the despacho ficha to open the support session dialog. */
export const SUPPORT_REQUIRED_PARAM = 'support';
/** Query param with the role B screen that was asked for, to open once the session starts. */
export const SUPPORT_RETURN_PARAM = 'returnUrl';

/** The role B screen to return to after starting a support session; anything else is ignored. */
export function supportReturnUrl(value: string | null | undefined): string | null {
  return value && value.startsWith('/b/') && !value.startsWith('//') ? value : null;
}

/** Area of a URL (`/a/…`, `/b/…`, `/c/…`), or null for routes outside the role areas. */
function areaOf(url: string): 'a' | 'b' | 'c' | null {
  const first = url.split(/[/?#]/).find((part) => part.length > 0);
  return first === 'a' || first === 'b' || first === 'c' ? first : null;
}

/**
 * Protege las rutas de la app: sin sesión, a `/login`; con sesión, cada rol solo navega por su área
 * (la app es de rol único por usuario). El rol A entra en las pantallas del rol B únicamente dentro de
 * una sesión de soporte del despacho que está viendo (odd/tasks/role-a-panel.md S5); sin ella vuelve a
 * la ficha del despacho, que abre el diálogo del modo soporte y, al iniciarla, vuelve a la pantalla pedida
 * (`?returnUrl=`). El servidor lo exige igualmente
 * (`SupportAccessGuard`): esto es navegación.
 */
export const roleGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser();
  if (!user) return router.createUrlTree(['/login']);

  // Solo en desarrollo el selector visual de rol cambia el rol efectivo.
  const role: Role = environment.mockRoleSwitch ? inject(StateService).currentRole() : user.role;
  const area = areaOf(state.url);
  if (!area || area === role.toLowerCase()) return true;

  if (role === 'A' && area === 'b') {
    const support = inject(SupportSessionService);
    const despacho = inject(DespachoContextService).selected();
    await support.ensureRestored();
    if (support.active()) return true;
    return router.createUrlTree(despacho ? ['/a/admins', despacho.id] : ['/a/admins'], {
      queryParams: despacho ? { [SUPPORT_REQUIRED_PARAM]: 'required', [SUPPORT_RETURN_PARAM]: state.url } : {},
    });
  }

  return router.parseUrl(ROLE_HOME[role] ?? '/login');
};
