import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_SUBSCRIPTION_GATE_KEY } from '../decorators/skip-subscription-gate.decorator';
import type { AuthenticatedUser } from '../auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Gate de acceso por estado de suscripción de la gestora (Administrator).
 * Solo aplica a rol B —el equipo de la gestora—: rol A (Domora) y rol C
 * (propietarios) nunca deben perder acceso por un problema de facturación
 * que no es suyo.
 *
 * Escalado a propósito, no binario:
 * - Activa / Periodo_de_gracia: acceso normal (el aviso al usuario es cosa
 *   del frontend, no de este guard).
 * - Vencida: solo lectura — cualquier método que no sea GET/HEAD se
 *   rechaza, pero pueden seguir consultando sus datos.
 * - Bloqueada: bloqueo total, salvo las rutas marcadas con
 *   @SkipSubscriptionGate() (ver el decorator) para que quien está
 *   bloqueado pueda todavía ver por qué y cómo resolverlo.
 *
 * Comprobación por petición (no embebida en el JWT): con los 15 minutos de
 * vida del access token, embeberlo habría dejado hasta ese margen de
 * acceso a una cuenta recién bloqueada — para un gate de negocio como este
 * (no un límite de seguridad crítico) es un coste aceptable, pero aquí se
 * prefiere la consistencia inmediata, al mismo costo que los ~70
 * `assertAccess` que ya hace el resto de la aplicación.
 */
@Injectable()
export class SubscriptionStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUBSCRIPTION_GATE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || user.role !== 'B' || !user.administratorId) return true;

    const admin = await this.prisma.administrator.findUnique({
      where: { id: user.administratorId },
      select: { status: true, blockReason: true },
    });
    if (!admin) return true; // no es responsabilidad de este guard

    if (admin.status === 'Bloqueada') {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_BLOCKED',
        message: admin.blockReason
          ? `Cuenta suspendida: ${admin.blockReason}`
          : 'Tu cuenta está suspendida. Contacta con Domora para regularizar tu suscripción.',
      });
    }

    if (admin.status === 'Vencida' && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message:
          'Tu suscripción está vencida. Puedes seguir consultando tus datos, pero no crear ni modificar nada hasta regularizar el pago.',
      });
    }

    return true;
  }
}
