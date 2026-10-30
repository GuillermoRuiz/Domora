import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Registro de accesos a datos personales sensibles (RGPD art. 32).
 * Se invoca desde los puntos que exponen IBANs, morosidad o ficheros SEPA.
 *
 * Dos decisiones a propósito, que conviene no confundir:
 *
 * 1. La llamada SÍ se espera (`await`) en el llamante. Antes se lanzaba con
 *    `void`, así que la operación podía responder antes de que la fila
 *    llegase a escribirse: un rastro que "probablemente se guardó" no sirve
 *    como prueba de nada, que es justo para lo que existe.
 * 2. Un fallo de escritura NO tumba la operación principal — un problema en
 *    la tabla de auditoría no debe dejar sin recibos a una comunidad. Pero
 *    se registra a nivel ERROR, no warning: perder trazabilidad de acceso a
 *    datos sensibles es un incidente, no un aviso menor.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logAccess(
    user: AuthenticatedUser,
    resource: string,
    action: string,
    resourceId?: string | null,
    detail?: string,
  ): Promise<void> {
    try {
      await this.prisma.dataAccessLog.create({
        data: {
          actorUserId: user.id,
          resource,
          resourceId: resourceId ?? null,
          action,
          detail: detail ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `RASTRO DE AUDITORÍA PERDIDO — acceso a ${resource}${resourceId ? ` (${resourceId})` : ''} por el usuario ${user.id} no registrado`,
        error as Error,
      );
    }
  }
}
