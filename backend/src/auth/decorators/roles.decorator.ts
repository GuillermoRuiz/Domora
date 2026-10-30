import { SetMetadata } from '@nestjs/common';
import type { AppRole } from '../auth.types';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to one or more of the three platform roles
 * ('A' platform admin, 'B' estate/community admin, 'C' owner/resident).
 * Used together with RolesGuard. Not consumed by any endpoint yet in
 * Fase 0 (only auth endpoints exist so far) but registered now so later
 * phases can use it without further wiring.
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
