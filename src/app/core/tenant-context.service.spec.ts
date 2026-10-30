import { TestBed } from '@angular/core/testing';
import { TenantContextService, TenantAccessDeniedError } from './tenant-context.service';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.service';
import { DespachoContextService } from './despacho-context.service';

/**
 * Defensa en profundidad en la capa de presentación (el enforcement real es
 * server-side, EstateAccessService — ver auditoria-seguridad-rendimiento.md).
 * Lo que importa probar aquí es exactamente lo que ese documento señala como
 * el error más fácil de cometer: que una lista de fincas vacía (o un usuario
 * sin sesión) restrinja a NADA, nunca que abra el acceso por accidente.
 */
describe('TenantContextService', () => {
  function setup(user: AuthenticatedUser | null): TenantContextService {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { currentUser: () => user } }],
    });
    return TestBed.inject(TenantContextService);
  }

  const roleB: AuthenticatedUser = {
    id: 'b1', fullName: 'Gestora', role: 'B', estateIds: ['e1', 'e2'], administratorId: 'admin1',
  };
  const roleA: AuthenticatedUser = {
    id: 'a1', fullName: 'Domora', role: 'A', estateIds: [], administratorId: null,
  };
  const roleC: AuthenticatedUser = {
    id: 'c1', fullName: 'Propietario', role: 'C', estateIds: ['e1'], administratorId: null,
  };

  describe('canAccess (por administratorId)', () => {
    it('sin usuario en sesión, deniega siempre', () => {
      const tenant = setup(null);
      expect(tenant.canAccess('admin1')).toBe(false);
    });

    it('rol A (super admin) accede a cualquier tenant', () => {
      const tenant = setup(roleA);
      expect(tenant.canAccess('cualquier-admin')).toBe(true);
    });

    it('rol B accede solo a recursos de SU gestora', () => {
      const tenant = setup(roleB);
      expect(tenant.canAccess('admin1')).toBe(true);
      expect(tenant.canAccess('admin-ajena')).toBe(false);
    });

    it('un recurso sin administratorId (null/undefined) se considera de alcance general', () => {
      const tenant = setup(roleB);
      expect(tenant.canAccess(null)).toBe(true);
      expect(tenant.canAccess(undefined)).toBe(true);
    });

    it('rol C no tiene tenant propio — el backend acota por membresías, aquí no se bloquea', () => {
      const tenant = setup(roleC);
      expect(tenant.canAccess('cualquier-admin')).toBe(true);
    });
  });

  describe('assertAccess', () => {
    it('lanza TenantAccessDeniedError si no hay acceso', () => {
      const tenant = setup(roleB);
      expect(() => tenant.assertAccess('admin-ajena', 'la finca X')).toThrow(TenantAccessDeniedError);
    });

    it('no lanza si el acceso es válido', () => {
      const tenant = setup(roleB);
      expect(() => tenant.assertAccess('admin1', 'la finca X')).not.toThrow();
    });
  });

  describe('canAccessEstate', () => {
    it('sin usuario en sesión, deniega siempre', () => {
      const tenant = setup(null);
      expect(tenant.canAccessEstate('e1')).toBe(false);
    });

    it('rol A accede a cualquier finca', () => {
      const tenant = setup(roleA);
      expect(tenant.canAccessEstate('finca-cualquiera')).toBe(true);
    });

    it('solo permite las fincas presentes en estateIds del JWT — nunca "todas" por defecto', () => {
      const tenant = setup(roleB);
      expect(tenant.canAccessEstate('e1')).toBe(true);
      expect(tenant.canAccessEstate('e2')).toBe(true);
      expect(tenant.canAccessEstate('e-ajena')).toBe(false);
    });

    it('un usuario sin ninguna finca vinculada (estateIds vacío) no accede a ninguna — no es "acceso total"', () => {
      const tenant = setup({ ...roleB, estateIds: [] });
      expect(tenant.canAccessEstate('e1')).toBe(false);
    });
  });

  describe('currentAdministratorId / accessibleEstateIds', () => {
    it('reflejan el administratorId y estateIds del usuario en sesión', () => {
      const tenant = setup(roleB);
      expect(tenant.currentAdministratorId()).toBe('admin1');
      expect(tenant.accessibleEstateIds()).toEqual(['e1', 'e2']);
    });

    it('sin sesión, ambos quedan vacíos/nulos', () => {
      const tenant = setup(null);
      expect(tenant.currentAdministratorId()).toBeNull();
      expect(tenant.accessibleEstateIds()).toEqual([]);
    });
  });
  describe('role A despacho context (odd/tasks/role-a-panel.md S1)', () => {
    beforeEach(() => sessionStorage.clear());
    afterEach(() => sessionStorage.clear());

    it('role A without a selected despacho has no tenant and no estate filter', () => {
      const tenant = setup(roleA);
      expect(tenant.currentAdministratorId()).toBeNull();
      expect(tenant.estateListFilter()).toEqual({});
    });

    it('role A with a selected despacho scopes to it and filters estate lists by it', () => {
      const tenant = setup(roleA);
      TestBed.inject(DespachoContextService).select({ id: 'd1', name: 'Fincas García' });
      expect(tenant.currentAdministratorId()).toBe('d1');
      expect(tenant.estateListFilter()).toEqual({ administratorId: 'd1' });
    });

    it('role B keeps its own administratorId and never sends the filter, even with a stored selection', () => {
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'b1', id: 'd1', name: 'X' }));
      const tenant = setup(roleB);
      TestBed.inject(DespachoContextService).select({ id: 'd2', name: 'Y' });
      expect(tenant.currentAdministratorId()).toBe('admin1');
      expect(tenant.estateListFilter()).toEqual({});
    });

    it('role C keeps a null tenant and no filter', () => {
      const tenant = setup(roleC);
      expect(tenant.currentAdministratorId()).toBeNull();
      expect(tenant.estateListFilter()).toEqual({});
    });
  });
});
