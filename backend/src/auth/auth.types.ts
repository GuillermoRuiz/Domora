/** Platform roles, mirrors Prisma's UserRole enum ('A' | 'B' | 'C'). */
export type AppRole = 'A' | 'B' | 'C';

/**
 * Claims encoded in the JWT access token. estateIds is the multi-tenancy
 * scope used by EstateScopeGuard/EstateAccessService in later phases
 * (see doc/plan.md section 2.4) — computed at login/refresh time, never
 * trusted from client input.
 */
export interface JwtPayload {
  sub: string;
  role: AppRole;
  estateIds: string[];
  administratorId: string | null;
}

/** Shape attached to `request.user` by JwtStrategy after validating the token. */
export interface AuthenticatedUser {
  id: string;
  role: AppRole;
  estateIds: string[];
  administratorId: string | null;
}
