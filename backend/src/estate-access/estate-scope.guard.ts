import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from './estate-access.service';

/**
 * Checks the `:estateId` route param against `user.estateIds` (the JWT
 * claim). Role A bypasses the check. For routes scoped by some other
 * resource id (e.g. `:propertyId`), resolve the owning estate in the
 * service layer and call `EstateAccessService.assertAccess` there instead —
 * this guard only covers the common case of a literal `estateId` param.
 */
@Injectable()
export class EstateScopeGuard implements CanActivate {
  constructor(private readonly estateAccess: EstateAccessService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: Record<string, string>;
    }>();
    const user = request.user;
    const estateId = request.params['estateId'];

    if (!user) {
      throw new ForbiddenException('No autenticado.');
    }
    if (!estateId) {
      return true;
    }
    this.estateAccess.assertAccess(estateId, user);
    return true;
  }
}
