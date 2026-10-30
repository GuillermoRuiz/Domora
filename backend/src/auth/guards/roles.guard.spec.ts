import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from '../decorators/roles.decorator';
import type { AppRole, AuthenticatedUser } from '../auth.types';

// Clases reales con decoradores reales: se quiere comprobar el mecanismo de
// metadatos de Nest tal cual se usa en producción, no un mock de él.
// `this: void` porque estos manejadores nunca usan `this` y aquí se pasan por
// referencia al contexto de ejecución — sin la anotación, la regla
// `unbound-method` avisa (con razón) de un posible `this` accidental.
@Roles('A', 'B')
class ManagementController {
  list(this: void): void {}

  // Excepción deliberada: el directorio de personal es la única ruta de este
  // controlador visible para un propietario (rol C). Depende de que el
  // @Roles de método tenga prioridad sobre el de clase.
  @Roles('A', 'B', 'C')
  directory(this: void): void {}
}

class OpenController {
  anything(this: void): void {}
}

function user(role: AppRole): AuthenticatedUser {
  return { id: 'u1', role, estateIds: [], administratorId: null };
}

function contextFor(
  authUser: AuthenticatedUser | undefined,
  handler: () => void,
  cls: new () => unknown,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: authUser }) }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = ManagementController.prototype;

  describe('@Roles a nivel de clase', () => {
    it('permite el paso a los roles declarados', () => {
      for (const role of ['A', 'B'] as AppRole[]) {
        expect(
          guard.canActivate(
            contextFor(user(role), proto.list, ManagementController),
          ),
        ).toBe(true);
      }
    });

    it('bloquea al rol no declarado', () => {
      expect(
        guard.canActivate(
          contextFor(user('C'), proto.list, ManagementController),
        ),
      ).toBe(false);
    });
  });

  describe('@Roles a nivel de método', () => {
    // Si esto se rompiese, el directorio de personal dejaría de ser visible
    // para los propietarios — o peor, una futura excepción de método pasaría
    // inadvertidamente a heredar los permisos de la clase.
    it('tiene prioridad sobre el de la clase y amplía el acceso', () => {
      expect(
        guard.canActivate(
          contextFor(user('C'), proto.directory, ManagementController),
        ),
      ).toBe(true);
    });

    it('sigue permitiendo los roles que ya tenía la clase', () => {
      for (const role of ['A', 'B'] as AppRole[]) {
        expect(
          guard.canActivate(
            contextFor(user(role), proto.directory, ManagementController),
          ),
        ).toBe(true);
      }
    });
  });

  describe('sin @Roles', () => {
    it('deja pasar a cualquier rol autenticado', () => {
      expect(
        guard.canActivate(
          contextFor(
            user('C'),
            OpenController.prototype.anything,
            OpenController,
          ),
        ),
      ).toBe(true);
    });
  });

  it('bloquea si no hay usuario en la petición aunque el rol encajase', () => {
    expect(
      guard.canActivate(
        contextFor(undefined, proto.list, ManagementController),
      ),
    ).toBe(false);
  });
});
