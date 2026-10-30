import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// Ante un 401 de la API propia, intenta refrescar el access token una vez y
// repite la petición original; si el refresh también falla, cierra la
// sesión y redirige a /login. Las peticiones de login/refresh/logout se
// excluyen para no entrar en bucle.
//
// Ante un 403 de SubscriptionStatusGuard con code SUBSCRIPTION_BLOCKED
// (cuenta suspendida — con este estado el guard corta TODO, incluidas las
// lecturas), manda a /b/subscription: es la única pantalla que el guard
// deja pasar siempre, así que es donde el usuario puede ver por qué y qué
// hacer. SUBSCRIPTION_EXPIRED (solo lectura) no redirige — el resto de la
// app sigue siendo usable, así que el mensaje del propio error alcanza.
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isAuthEndpoint = /\/auth\/(login|refresh|logout)$/.test(req.url);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        req.url.startsWith(environment.apiBaseUrl) &&
        !isAuthEndpoint
      ) {
        return from(auth.refresh()).pipe(
          switchMap((token) => next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))),
          catchError((refreshError: unknown) => {
            void auth.logout();
            void router.navigate(['/login']);
            return throwError(() => refreshError);
          }),
        );
      }
      if (
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        error.error?.code === 'SUBSCRIPTION_BLOCKED' &&
        !router.url.startsWith('/b/subscription')
      ) {
        void router.navigate(['/b/subscription']);
      }
      return throwError(() => error);
    }),
  );
};
