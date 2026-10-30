import type { ConfigService } from '@nestjs/config';

/**
 * Origen base del frontend Angular — usado para construir enlaces
 * absolutos que se envían fuera de la app (emails, `success_url`/
 * `cancel_url` de Stripe Checkout, enlaces de sala de espera de juntas).
 * `CORS_ORIGIN` admite una lista separada por comas (varios orígenes
 * permitidos); el primero es el que se considera "el frontend" a efectos
 * de construir estos enlaces.
 *
 * Antes duplicado idéntico en `MeetingsService` y `BillingService`.
 */
export function resolveFrontendBaseUrl(config: ConfigService): string {
  const raw = config.get<string>('CORS_ORIGIN') ?? 'http://localhost:4200';
  return raw.split(',')[0].trim();
}
