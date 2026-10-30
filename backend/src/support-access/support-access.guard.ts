import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { DespachoResolverService, isUuid, type DespachoTarget } from './despacho-resolver.service';
import { StaffAuditService, type StaffAuditEntry } from './staff-audit.service';
import { SupportSessionsService } from './support-sessions.service';
import { classifyRoute, isReadOnlyRequest, routeTemplate } from './route-scope';

/** Header carrying the id of the caller's active support session. */
export const SUPPORT_SESSION_HEADER = 'x-support-session';

export const SUPPORT_MESSAGES = {
  noSession:
    'Estás en modo consulta. Para modificar datos de un despacho inicia una sesión de soporte.',
  invalidSession:
    'La sesión de soporte no es válida, ha terminado o ha caducado. Inicia una nueva.',
  otherDespacho:
    'La sesión de soporte activa es de otro despacho. Inicia una sesión de soporte para este despacho.',
  unresolved:
    'No se puede determinar a qué despacho afecta esta operación, así que no está permitida en modo soporte.',
  auditUnavailable:
    'No se ha podido registrar el acceso en la auditoría. Inténtalo de nuevo en unos minutos.',
} as const;

interface GuardedRequest {
  user?: AuthenticatedUser;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
}

/**
 * Global guard, registered right after RolesGuard (odd/tasks/role-a-panel.md
 * S5): role A is read-only on tenant routes unless it works inside an
 * explicit support session of the target despacho, and every role A request
 * to a tenant route is audited (reads, writes and denials).
 *
 * Roles B and C, anonymous requests and role A on platform or self routes
 * pass straight through: no lookup, no audit row.
 */
@Injectable()
export class SupportAccessGuard implements CanActivate {
  private readonly logger = new Logger(SupportAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: DespachoResolverService,
    private readonly sessions: SupportSessionsService,
    private readonly audit: StaffAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<GuardedRequest>();
    const user = req.user;
    if (!user || user.role !== 'A') return true;

    const roles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const route = routeTemplate(context.getClass(), context.getHandler());
    if (classifyRoute(roles, route) !== 'tenant') return true;

    const method = req.method.toUpperCase();
    const target = await this.resolver.resolve(route, req.params ?? {});
    const base = { staffUserId: user.id, method, route };

    if (isReadOnlyRequest(method, route)) {
      const queried = req.query?.administratorId;
      await this.recordOrFail({
        ...base,
        administratorId: target?.administratorId ?? (isUuid(queried) ? queried : null),
        estateId: target?.estateId ?? null,
        supportSessionId: null,
        action: 'read',
      });
      return true;
    }

    const header = req.headers[SUPPORT_SESSION_HEADER];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (!sessionId) return this.deny(base, target, null, SUPPORT_MESSAGES.noSession);
    const session = isUuid(sessionId) ? await this.sessions.findValid(sessionId, user.id) : null;
    if (!session) return this.deny(base, target, null, SUPPORT_MESSAGES.invalidSession);
    if (!target) return this.deny(base, target, session.id, SUPPORT_MESSAGES.unresolved);
    if (target.administratorId !== session.administratorId) {
      return this.deny(base, target, session.id, SUPPORT_MESSAGES.otherDespacho);
    }
    await this.recordOrFail({
      ...base,
      administratorId: target.administratorId,
      estateId: target.estateId,
      supportSessionId: session.id,
      action: 'write',
    });
    return true;
  }

  /** Fail closed: an access that cannot be audited does not happen. */
  private async recordOrFail(entry: StaffAuditEntry): Promise<void> {
    try {
      await this.audit.record(entry);
    } catch (error) {
      this.logger.error(`Staff audit write failed: ${String(error)}`);
      throw new ServiceUnavailableException(SUPPORT_MESSAGES.auditUnavailable);
    }
  }

  private async deny(
    base: Pick<StaffAuditEntry, 'staffUserId' | 'method' | 'route'>,
    target: DespachoTarget | null,
    supportSessionId: string | null,
    message: string,
  ): Promise<never> {
    try {
      await this.audit.record({
        ...base,
        administratorId: target?.administratorId ?? null,
        estateId: target?.estateId ?? null,
        supportSessionId,
        action: 'denied',
      });
    } catch (error) {
      // The request is refused anyway; the failure is logged, never hidden.
      this.logger.error(`Staff audit write (denied) failed: ${String(error)}`);
    }
    throw new ForbiddenException(message);
  }
}
