import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { tenantAccountingGuard, tenantEstateGuard } from './tenant.guard';
import { TenantContextService } from './tenant-context.service';

/**
 * Primera línea de defensa contra cross-tenant access por URL manipulada
 * (la real vive server-side, EstateScopeGuard). Se prueba directamente el
 * guard funcional con TenantContextService mockeado — no hace falta
 * AuthService real de por medio.
 */
describe('tenantEstateGuard / tenantAccountingGuard', () => {
  function setup(canAccessEstate: boolean): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TenantContextService, useValue: { canAccessEstate: () => canAccessEstate } },
      ],
    });
  }

  function routeWithId(id: string | null): ActivatedRouteSnapshot {
    return { paramMap: { get: () => id } } as unknown as ActivatedRouteSnapshot;
  }
  const noopState = {} as RouterStateSnapshot;

  describe('tenantEstateGuard', () => {
    it('permite el acceso si la finca pertenece al tenant activo', () => {
      setup(true);
      const result = TestBed.runInInjectionContext(() => tenantEstateGuard(routeWithId('e1'), noopState));
      expect(result).toBe(true);
    });

    it('redirige a /b/estates si la finca es de otro tenant', () => {
      setup(false);
      const result = TestBed.runInInjectionContext(() => tenantEstateGuard(routeWithId('e-ajena'), noopState)) as UrlTree;
      const router = TestBed.inject(Router);
      expect(router.serializeUrl(result)).toBe('/b/estates');
    });

    it('sin :id en la ruta, deja pasar — no hay nada que verificar', () => {
      setup(false);
      const result = TestBed.runInInjectionContext(() => tenantEstateGuard(routeWithId(null), noopState));
      expect(result).toBe(true);
    });
  });

  describe('tenantAccountingGuard', () => {
    it('permite el acceso si la contabilidad pertenece al tenant activo', () => {
      setup(true);
      const result = TestBed.runInInjectionContext(() => tenantAccountingGuard(routeWithId('acc1'), noopState));
      expect(result).toBe(true);
    });

    it('redirige a /b/accounting si la contabilidad es de otro tenant', () => {
      setup(false);
      const result = TestBed.runInInjectionContext(() => tenantAccountingGuard(routeWithId('acc-ajena'), noopState)) as UrlTree;
      const router = TestBed.inject(Router);
      expect(router.serializeUrl(result)).toBe('/b/accounting');
    });
  });
});
