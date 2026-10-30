import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// Adjunta el access token a las peticiones dirigidas a la API propia. No se
// añade a peticiones a otros orígenes (evita filtrar el token a terceros).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  const token = auth.accessToken();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authReq);
};
