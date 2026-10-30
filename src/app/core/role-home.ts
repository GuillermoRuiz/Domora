import { inject } from '@angular/core';
import { Router, type RedirectFunction } from '@angular/router';

import { AuthService } from './auth.service';

/** Landing route for each platform role. */
export const ROLE_HOME: Record<string, string> = { A: '/a/overview', B: '/b/overview', C: '/c/community' };

/** Sends the current user to their role's landing route (or to login without a session). */
export const roleHomeRedirect: RedirectFunction = () => {
  const role = inject(AuthService).currentUser()?.role;
  return inject(Router).parseUrl((role && ROLE_HOME[role]) || '/login');
};
