import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AppRole } from '../auth/auth.types';
import {
  EstateExternalOwnersController,
  ExternalOwnersController,
  PropertyExternalOwnersController,
} from './external-owners.controller';

/**
 * Regresión de privacidad: un titular externo lleva NIF, email, teléfono y
 * dirección de un propietario sin cuenta. Se ejecuta el RolesGuard real
 * contra la metadata de cada handler — si alguien quita el @Roles, falla.
 */
function contextFor(role: AppRole, controller: object, handler: (...args: never[]) => unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', role, estateIds: ['e1'], administratorId: null } }) }),
  } as unknown as ExecutionContext;
}

const guard = new RolesGuard(new Reflector());

const HANDLERS = [
  ['GET /estates/:estateId/external-owners', EstateExternalOwnersController, EstateExternalOwnersController.prototype.listByEstate],
  ['GET /external-owners/:id', ExternalOwnersController, ExternalOwnersController.prototype.findById],
  ['POST /properties/:propertyId/external-owners', PropertyExternalOwnersController, PropertyExternalOwnersController.prototype.create],
  ['PATCH /external-owners/:id', ExternalOwnersController, ExternalOwnersController.prototype.update],
  ['DELETE /external-owners/:id', ExternalOwnersController, ExternalOwnersController.prototype.remove],
] as const;

describe('ExternalOwners — solo gestora o Domora', () => {
  it.each(HANDLERS)('%s rechaza a un vecino (rol C)', (_label, controller, handler) => {
    const run = () => guard.canActivate(contextFor('C', controller, handler));
    // El guard puede devolver false o lanzar Forbidden según su implementación: ambas cierran el acceso.
    let allowed: boolean;
    try {
      allowed = run();
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      allowed = false;
    }
    expect(allowed).toBe(false);
  });

  it.each(HANDLERS)('%s deja pasar a la gestora (rol B) y a Domora (rol A)', (_label, controller, handler) => {
    expect(guard.canActivate(contextFor('B', controller, handler))).toBe(true);
    expect(guard.canActivate(contextFor('A', controller, handler))).toBe(true);
  });
});
