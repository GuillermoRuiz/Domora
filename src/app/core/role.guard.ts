import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

// Protege las rutas de la app frente a acceso sin sesión. Nótese que no
// distingue todavía por rol (Role A/B/C) más allá de exigir un usuario
// autenticado — la app sigue siendo de rol único por usuario (ver
// doc/backend-execution-plan.md, decisión "multi-rol diferido").
export const roleGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  return router.createUrlTree(['/login']);
};
