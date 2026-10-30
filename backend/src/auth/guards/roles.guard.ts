import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AppRole, AuthenticatedUser } from '../auth.types';

/**
 * Reusable role check, registered alongside JwtAuthGuard. No endpoint in
 * Fase 0 uses @Roles(...) yet (only auth endpoints exist, and they are
 * either @Public() or open to any authenticated role), but the guard is
 * wired now so Fase 1+ modules can adopt it without extra setup.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    return !!user && requiredRoles.includes(user.role);
  }
}
