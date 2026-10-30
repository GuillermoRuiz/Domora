import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from './estate-access.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

/**
 * El aislamiento entre gestoras descansa entero sobre esta clase: `estateIds`
 * viene del JWT (calculado en login/refresh) y es la única fuente de verdad,
 * nunca el `estateId` que envía el cliente. Si esto se relaja, se filtran
 * datos entre comunidades.
 */
describe('EstateAccessService', () => {
  const service = new EstateAccessService();

  const MINE = 'estate-propia';
  const OTHER = 'estate-ajena';

  function user(role: AppRole, estateIds: string[] = []): AuthenticatedUser {
    return { id: 'u1', role, estateIds, administratorId: 'admin-1' };
  }

  describe('canAccess', () => {
    it('permite el acceso a una finca del propio ámbito', () => {
      expect(service.canAccess(MINE, user('B', [MINE]))).toBe(true);
    });

    it('niega el acceso a una finca ajena', () => {
      expect(service.canAccess(OTHER, user('B', [MINE]))).toBe(false);
    });

    it('niega el acceso a un usuario sin fincas asignadas', () => {
      expect(service.canAccess(MINE, user('C', []))).toBe(false);
    });

    it('el rol A (plataforma) no está sujeto al ámbito', () => {
      expect(service.canAccess(OTHER, user('A', []))).toBe(true);
    });

    it('aplica la misma regla al rol C: solo sus propias fincas', () => {
      expect(service.canAccess(MINE, user('C', [MINE]))).toBe(true);
      expect(service.canAccess(OTHER, user('C', [MINE]))).toBe(false);
    });

    it('trata null/undefined como "sin finca concreta" y no bloquea', () => {
      expect(service.canAccess(null, user('B', [MINE]))).toBe(true);
      expect(service.canAccess(undefined, user('B', [MINE]))).toBe(true);
    });
  });

  describe('assertAccess', () => {
    it('no lanza cuando hay acceso', () => {
      expect(() => service.assertAccess(MINE, user('B', [MINE]))).not.toThrow();
    });

    it('lanza Forbidden cuando no lo hay', () => {
      expect(() => service.assertAccess(OTHER, user('B', [MINE]))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('scopedWhere', () => {
    it('restringe la consulta a las fincas del usuario', () => {
      expect(service.scopedWhere(user('B', [MINE]))).toEqual({
        estateId: { in: [MINE] },
      });
    });

    it('con lista vacía restringe a nada (no abre el acceso)', () => {
      // Un `{}` aquí sería un fallo de aislamiento: devolvería TODAS las filas.
      expect(service.scopedWhere(user('C', []))).toEqual({
        estateId: { in: [] },
      });
    });

    it('el rol A consulta sin restricción', () => {
      expect(service.scopedWhere(user('A', []))).toEqual({});
    });
  });
});
