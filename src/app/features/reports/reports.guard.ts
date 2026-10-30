import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { OWNER_HOME } from '../../core/owner-routes';

/** Navegación únicamente; cada consulta y exportación se autoriza de nuevo en el servidor. */
export const reportsRoleGuard: CanActivateFn = () => {
  const user = inject(AuthService).currentUser(); const router = inject(Router);
  return user?.role === 'B' || router.createUrlTree([!user ? '/login' : user.role === 'A' ? '/a/admins' : OWNER_HOME]);
};
