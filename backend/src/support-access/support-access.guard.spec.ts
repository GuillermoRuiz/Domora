import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import {
  SupportAccessGuard,
  SUPPORT_SESSION_HEADER,
  SUPPORT_MESSAGES,
} from './support-access.guard';
import type { DespachoResolverService } from './despacho-resolver.service';
import type { StaffAuditService } from './staff-audit.service';
import type { SupportSessionsService } from './support-sessions.service';

const STAFF = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const OTHER_ADMIN = '44444444-4444-4444-8444-444444444444';
const ESTATE = '55555555-5555-4555-8555-555555555555';
const SESSION = '33333333-3333-4333-8333-333333333333';

@Controller('estates/:estateId/cost-centres')
@Roles('A', 'B')
class TenantController {
  @Get() list(this: void): void {}
  @Post() create(this: void): void {}
}

@Controller('estates')
class OpenController {
  @Post(':estateId/x') write(this: void): void {}
}

@Controller('estates/:estateId/properties')
@Roles('A', 'B')
class PreviewController {
  @Post('coefficients/preview-by-area') preview(this: void): void {}
}

@Controller('admins')
@Roles('A')
class PlatformController {
  @Post() create(this: void): void {}
}

@Controller('platform-metrics')
@Roles('A')
class MetricsController {
  @Post('mrr') recompute(this: void): void {}
}

function user(role: AppRole): AuthenticatedUser {
  return { id: STAFF, role, estateIds: [], administratorId: null };
}

function ctx(
  authUser: AuthenticatedUser | undefined,
  method: string,
  cls: new () => unknown,
  handler: () => void,
  headers: Record<string, string> = {},
  params: Record<string, string> = { estateId: ESTATE },
  query: Record<string, unknown> = {},
): ExecutionContext {
  const req = { user: authUser, method, headers, params, query };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function build(opts: { target?: { administratorId: string; estateId: string | null } | null; session?: unknown } = {}) {
  const resolver = {
    resolve: jest.fn().mockResolvedValue(
      opts.target === undefined ? { administratorId: ADMIN, estateId: ESTATE } : opts.target,
    ),
  };
  const sessions = { findValid: jest.fn().mockResolvedValue(opts.session ?? null) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const guard = new SupportAccessGuard(
    new Reflector(),
    resolver as unknown as DespachoResolverService,
    sessions as unknown as SupportSessionsService,
    audit as unknown as StaffAuditService,
  );
  return { guard, resolver, sessions, audit };
}

const t = new TenantController();
const validSession = { id: SESSION, staffUserId: STAFF, administratorId: ADMIN };

describe('SupportAccessGuard', () => {
  it.each(['B', 'C'] as AppRole[])('lets role %s through untouched and unaudited', async (role) => {
    const { guard, resolver, audit } = build();
    await expect(guard.canActivate(ctx(user(role), 'POST', TenantController, t.create))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets anonymous requests through (public routes)', async () => {
    const { guard, audit } = build();
    await expect(guard.canActivate(ctx(undefined, 'POST', TenantController, t.create))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('leaves role A platform and self routes alone', async () => {
    const { guard, audit } = build();
    await expect(
      guard.canActivate(ctx(user('A'), 'POST', PlatformController, new PlatformController().create)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx(user('A'), 'POST', MetricsController, new MetricsController().recompute)),
    ).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('audits a role A read with the route template and despacho', async () => {
    const { guard, audit, sessions } = build();
    await expect(guard.canActivate(ctx(user('A'), 'GET', TenantController, t.list))).resolves.toBe(true);
    expect(sessions.findValid).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith({
      staffUserId: STAFF,
      administratorId: ADMIN,
      estateId: ESTATE,
      supportSessionId: null,
      action: 'read',
      method: 'GET',
      route: 'estates/:estateId/cost-centres',
    });
  });

  it('takes the despacho of a read from ?administratorId= when params do not resolve it', async () => {
    const { guard, audit } = build({ target: null });
    await guard.canActivate(
      ctx(user('A'), 'GET', TenantController, t.list, {}, {}, { administratorId: OTHER_ADMIN }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ administratorId: OTHER_ADMIN, estateId: null }),
    );
    audit.record.mockClear();
    await guard.canActivate(
      ctx(user('A'), 'GET', TenantController, t.list, {}, {}, { administratorId: 'nope' }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ administratorId: null }));
  });

  it('fails closed with 503 when a read cannot be audited', async () => {
    const { guard, audit } = build();
    audit.record.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(ctx(user('A'), 'GET', TenantController, t.list))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  async function expectDenied(
    built: ReturnType<typeof build>,
    context: ExecutionContext,
    message: string,
    sessionId: string | null = null,
  ) {
    const error = await built.guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(message);
    expect(built.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'denied', method: 'POST', route: 'estates/:estateId/cost-centres', supportSessionId: sessionId }),
    );
  }

  it('denies a role A write without a support session', async () => {
    const built = build();
    await expectDenied(built, ctx(user('A'), 'POST', TenantController, t.create), SUPPORT_MESSAGES.noSession);
    expect(built.sessions.findValid).not.toHaveBeenCalled();
  });

  it('denies a session id that is not a UUID without querying it', async () => {
    const built = build();
    await expectDenied(
      built,
      ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: 'abc' }),
      SUPPORT_MESSAGES.invalidSession,
    );
    expect(built.sessions.findValid).not.toHaveBeenCalled();
  });

  it('denies a foreign, ended or expired session (not found as valid for the caller)', async () => {
    const built = build({ session: null });
    await expectDenied(
      built,
      ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: SESSION }),
      SUPPORT_MESSAGES.invalidSession,
    );
    expect(built.sessions.findValid).toHaveBeenCalledWith(SESSION, STAFF);
  });

  it('denies a valid session of another despacho', async () => {
    const built = build({ session: { ...validSession, administratorId: OTHER_ADMIN } });
    await expectDenied(
      built,
      ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: SESSION }),
      SUPPORT_MESSAGES.otherDespacho,
      SESSION,
    );
  });

  it('denies a write whose despacho cannot be resolved', async () => {
    const built = build({ target: null, session: validSession });
    await expectDenied(
      built,
      ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: SESSION }),
      SUPPORT_MESSAGES.unresolved,
      SESSION,
    );
  });

  it('still answers 403 when the denial cannot be audited', async () => {
    const built = build();
    built.audit.record.mockRejectedValue(new Error('db down'));
    await expect(built.guard.canActivate(ctx(user('A'), 'POST', TenantController, t.create))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets a write with a valid session of the target despacho through and audits it', async () => {
    const built = build({ session: validSession });
    await expect(
      built.guard.canActivate(ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: SESSION })),
    ).resolves.toBe(true);
    expect(built.audit.record).toHaveBeenCalledWith({
      staffUserId: STAFF,
      administratorId: ADMIN,
      estateId: ESTATE,
      supportSessionId: SESSION,
      action: 'write',
      method: 'POST',
      route: 'estates/:estateId/cost-centres',
    });
  });

  it('fails closed with 503 when an allowed write cannot be audited', async () => {
    const built = build({ session: validSession });
    built.audit.record.mockRejectedValue(new Error('db down'));
    await expect(
      built.guard.canActivate(ctx(user('A'), 'POST', TenantController, t.create, { [SUPPORT_SESSION_HEADER]: SESSION })),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('treats a route without @Roles as a tenant route for role A', async () => {
    const built = build();
    const error = await built.guard
      .canActivate(ctx(user('A'), 'POST', OpenController, new OpenController().write))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('audits an allowlisted read-only POST as a read, without a session', async () => {
    const built = build();
    await expect(
      built.guard.canActivate(ctx(user('A'), 'POST', PreviewController, new PreviewController().preview)),
    ).resolves.toBe(true);
    expect(built.sessions.findValid).not.toHaveBeenCalled();
    expect(built.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'read',
        method: 'POST',
        route: 'estates/:estateId/properties/coefficients/preview-by-area',
        supportSessionId: null,
      }),
    );
  });
});
