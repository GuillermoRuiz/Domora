import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Multi-tenancy is enforced at the application layer, not via DB-level RLS
 * (doc/plan.md section 2.4). `AuthenticatedUser.estateIds` — the JWT claim
 * computed at login/refresh — is the single source of truth; a client-sent
 * `estateId` is never trusted on its own; it is only used to look up the
 * record, whose real `estateId` is what gets checked here.
 */
@Injectable()
export class EstateAccessService {
  /** Role A (platform admin) bypasses estate scoping entirely. */
  canAccess(
    estateId: string | null | undefined,
    user: AuthenticatedUser,
  ): boolean {
    if (user.role === 'A') return true;
    if (estateId == null) return true;
    return user.estateIds.includes(estateId);
  }

  assertAccess(
    estateId: string | null | undefined,
    user: AuthenticatedUser,
  ): void {
    if (!this.canAccess(estateId, user)) {
      throw new ForbiddenException(`Acceso denegado a la finca ${estateId}.`);
    }
  }

  /**
   * Prisma `where` fragment that scopes a query to the estates the user may
   * see. Role A gets `{}` (no restriction); every other role is restricted
   * to `estateId IN (user.estateIds)`, even if that array is empty (`[]`
   * correctly matches nothing).
   */
  scopedWhere(user: AuthenticatedUser): { estateId?: { in: string[] } } {
    if (user.role === 'A') return {};
    return { estateId: { in: user.estateIds } };
  }
}
