import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Rate limiting de login (Fase 15): máximo 5 intentos por minuto por
 * combinación IP+email. In-memory a propósito — sin Redis en el stack
 * (decisión de doc/plan.md); en un despliegue multi-instancia el límite
 * es por instancia, lo cual sigue frenando fuerza bruta de forma efectiva.
 * El mapa se poda en cada pasada para no crecer sin límite.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const email = (request.body as { email?: string })?.email ?? '';
    const key = `${request.ip}|${email.toLowerCase()}`;
    const now = Date.now();

    const recent = (this.attempts.get(key) ?? []).filter(
      (t) => now - t < WINDOW_MS,
    );
    if (recent.length >= MAX_ATTEMPTS) {
      throw new HttpException(
        'Demasiados intentos de acceso. Espera un minuto.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.attempts.set(key, recent);

    // Poda periódica de claves frías.
    if (this.attempts.size > 10_000) {
      for (const [k, times] of this.attempts) {
        if (times.every((t) => now - t >= WINDOW_MS)) this.attempts.delete(k);
      }
    }
    return true;
  }
}
