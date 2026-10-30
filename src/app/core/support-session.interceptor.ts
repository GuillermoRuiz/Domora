import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { SupportSessionService } from './support-session.service';

/** Header the backend `SupportAccessGuard` reads to let role A write inside a support session. */
export const SUPPORT_SESSION_HEADER = 'X-Support-Session';

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Support mode (odd/tasks/role-a-panel.md S5): while role A has an open support session for the
 * selected despacho, non-GET requests to the own API carry `X-Support-Session: <id>`. Reads never
 * do (role A reads are always allowed and audited), and other origins never see it. A 403 from the
 * support guard is handed to `SupportSessionService` so the user is told and offered support mode;
 * the error still reaches the caller.
 */
export const supportSessionInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) return next(req);

  const support = inject(SupportSessionService);
  const session = support.active();
  const outgoing = session && !READ_METHODS.has(req.method.toUpperCase())
    ? req.clone({ setHeaders: { [SUPPORT_SESSION_HEADER]: session.id } })
    : req;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        support.handleForbidden(error.error?.message);
      }
      return throwError(() => error);
    }),
  );
};
