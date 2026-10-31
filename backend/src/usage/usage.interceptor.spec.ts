import { CallHandler, Controller, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsageRecorder } from './usage-recorder.service';
import { UsageInterceptor } from './usage.interceptor';

/** A controller class carrying real `@Controller(path)` metadata. */
function controller(path: string): new () => unknown {
  class Fake {}
  Controller(path)(Fake);
  return Fake;
}

/**
 * An HTTP context for a handler of `controllerPath` whose full matched route is
 * `/api/v1/<controllerPath>/<methodPath>` (what Express exposes as `req.route.path`).
 */
function context(
  req: Record<string, unknown>,
  opts: {
    controllerPath?: string;
    methodPath?: string;
    handler?: () => void;
    type?: string;
  } = {},
): ExecutionContext {
  const {
    controllerPath = 'estates',
    methodPath = '',
    handler = () => undefined,
    type = 'http',
  } = opts;
  const route = {
    path: `/api/v1/${controllerPath}${methodPath ? `/${methodPath}` : ''}`,
  };
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller(controllerPath),
    switchToHttp: () => ({ getRequest: () => ({ route, ...req }) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('response') };

function user(
  role: 'A' | 'B' | 'C',
  administratorId: string | null = null,
): AuthenticatedUser {
  return { id: `user-${role}`, role, estateIds: [], administratorId };
}

describe('UsageInterceptor', () => {
  let recorder: { record: jest.Mock };
  let interceptor: UsageInterceptor;

  beforeEach(() => {
    recorder = { record: jest.fn() };
    interceptor = new UsageInterceptor(
      new Reflector(),
      recorder as unknown as UsageRecorder,
    );
  });

  it('records an authenticated role B request with its despacho and module', async () => {
    const ctx = context(
      { user: user('B', 'adm1') },
      { controllerPath: 'estates/:estateId/receipts' },
    );
    await expect(lastValueFrom(interceptor.intercept(ctx, next))).resolves.toBe(
      'response',
    );
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-B',
        role: 'B',
        administratorId: 'adm1',
        module: 'receipts',
      }),
    );
  });

  it('records role C without a despacho (resolved later from estates)', async () => {
    const ctx = context(
      { user: user('C', 'adm-ignored') },
      { controllerPath: 'me/documents' },
    );
    await lastValueFrom(interceptor.intercept(ctx, next));
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-C',
        role: 'C',
        administratorId: null,
        module: 'documents',
      }),
    );
  });

  // Real routes of the codebase: [controller path, method path, expected module].
  // Actions and sub-paths of a handler (`:id/cancel`, `:id/agenda/...`) never
  // become modules; only the controller's own path decides.
  it.each([
    ['me/issues', ':id/withdraw', 'issues'],
    ['issues', ':id/status', 'issues'],
    ['receipts', ':id/cancel', 'receipts'],
    ['bookings', ':id/cancel', 'bookings'],
    ['meetings', ':id/agenda/:itemId/treated', 'meetings'],
    ['amenities', ':id/availability', 'amenities'],
    ['membership-invites', ':token/redeem', 'membership-invites'],
    ['issues', ':id/notifications', 'issues'],
    ['estates/:estateId/receipts', ':id', 'receipts'],
    ['estates/:estateId/accounting', 'summary', 'accounting'],
    ['properties/:propertyId/issues', '', 'issues'],
    ['users/:userId/receipts', '', 'receipts'],
    ['meetings/:meetingId/attachments', ':attachmentId', 'attachments'],
    ['estates/:estateId', 'setup', 'estates'],
    ['gdpr/me', 'erasure', 'gdpr'],
  ])(
    '%s + %s counts as module %s',
    async (controllerPath, methodPath, expected) => {
      await lastValueFrom(
        interceptor.intercept(
          context({ user: user('B', 'adm1') }, { controllerPath, methodPath }),
          next,
        ),
      );
      expect(recorder.record).toHaveBeenCalledWith(
        expect.objectContaining({ module: expected }),
      );
    },
  );

  it('skips role A: Domora staff usage is not client adoption', async () => {
    await lastValueFrom(
      interceptor.intercept(context({ user: user('A') }), next),
    );
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('skips @Public() routes even when a user is attached', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    await lastValueFrom(
      interceptor.intercept(
        context(
          { user: user('B', 'adm1') },
          { controllerPath: 'plans', handler },
        ),
        next,
      ),
    );
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('skips anonymous requests, noise controllers, the root controller and non-HTTP contexts', async () => {
    await lastValueFrom(interceptor.intercept(context({}), next));
    await lastValueFrom(
      interceptor.intercept(
        context(
          { user: user('B', 'adm1') },
          { controllerPath: 'notifications' },
        ),
        next,
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        context(
          { user: user('B', 'adm1') },
          { controllerPath: 'auth', methodPath: 'me' },
        ),
        next,
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        context(
          { user: user('B', 'adm1') },
          { controllerPath: '', methodPath: 'health' },
        ),
        next,
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        context({ user: user('B', 'adm1') }, { type: 'rpc' }),
        next,
      ),
    );
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('never breaks the request when recording throws', async () => {
    recorder.record.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      lastValueFrom(
        interceptor.intercept(context({ user: user('B', 'adm1') }), next),
      ),
    ).resolves.toBe('response');
  });
});
