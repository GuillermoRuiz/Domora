import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { roleGuard } from './role.guard';
import { AuthService } from './auth.service';

/**
 * Guard funcional — usa inject() internamente, así que necesita un contexto
 * de inyección real (TestBed.runInInjectionContext), pero no hace falta
 * montar ningún componente ni TestBed completo de renderizado.
 */
describe('roleGuard', () => {
  function setup(isAuthenticated: boolean): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
      ],
    });
  }

  const noop = {} as ActivatedRouteSnapshot;
  const noopState = {} as RouterStateSnapshot;

  it('con sesión activa, permite el acceso', () => {
    setup(true);
    const result = TestBed.runInInjectionContext(() => roleGuard(noop, noopState));
    expect(result).toBe(true);
  });

  it('sin sesión, redirige a /login', () => {
    setup(false);
    const result = TestBed.runInInjectionContext(() => roleGuard(noop, noopState)) as UrlTree;
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result)).toBe('/login');
  });
});
