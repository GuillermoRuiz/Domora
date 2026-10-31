import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** What `SupportAccessGuard` leaves on the request once it accepts a support session. */
export interface SupportSessionScope {
  id: string;
  administratorId: string;
}

export interface SupportScopedRequest {
  supportSession?: SupportSessionScope;
}

/**
 * The despacho of the role A support session that authorised this request
 * (odd/tasks/role-a-panel.md S5, L51), or undefined outside one (roles B/C, or
 * role A on platform and self routes). Routes that list across despachos for
 * role A scope to it when the request names no despacho.
 */
export const SupportDespacho = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<SupportScopedRequest>().supportSession
      ?.administratorId,
);
