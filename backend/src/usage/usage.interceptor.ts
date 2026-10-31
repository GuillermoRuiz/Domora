import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { moduleKeyFromControllerPath } from './usage-module-key';
import { UsageRecorder } from './usage-recorder.service';

/**
 * Global interceptor (runs after the guards, so `request.user` is set): counts
 * every authenticated role B/C request towards that user's daily usage. Skips
 * `@Public()` routes, anonymous requests, role A (Domora staff is not client
 * adoption) and noise routes. Recording is in-memory and wrapped so it can
 * never fail the request.
 */
function controllerPath(controller: unknown): string | undefined {
  const path: unknown = controller
    ? Reflect.getMetadata(PATH_METADATA, controller)
    : undefined;
  const first: unknown = Array.isArray(path) ? path[0] : path;
  return typeof first === 'string' ? first : undefined;
}

@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly recorder: UsageRecorder,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    try {
      this.capture(context);
    } catch {
      // Usage is best-effort.
    }
    return next.handle();
  }

  private capture(context: ExecutionContext): void {
    if (context.getType() !== 'http') return;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return;
    const req = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user?.id || (user.role !== 'B' && user.role !== 'C')) return;
    // The module comes from the handling controller's own path, never from
    // the handler's sub-path (interceptors only run for matched handlers).
    const module = moduleKeyFromControllerPath(
      controllerPath(context.getClass()),
    );
    if (!module) return;
    this.recorder.record({
      userId: user.id,
      role: user.role,
      administratorId:
        user.role === 'B' ? (user.administratorId ?? null) : null,
      module,
    });
  }
}
