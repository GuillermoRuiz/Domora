import { ForbiddenException } from '@nestjs/common';
import { UserRepresentationsService } from './user-representations.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

/**
 * Test de regresión de un IDOR real: estos endpoints recibían el `userId` por
 * la ruta y consultaban directamente, sin compararlo nunca con el usuario
 * autenticado. Cualquiera podía reconstruir el grafo de apoderamientos de
 * toda la plataforma iterando UUIDs.
 *
 * Lo que se fija aquí es que la comprobación ocurre ANTES de tocar la base de
 * datos: si `findMany` llega a llamarse en un caso denegado, la protección
 * estaría mal colocada aunque el endpoint devolviese 403.
 */
describe('UserRepresentationsService — autorización', () => {
  const ME = 'user-propio';
  const OTHER = 'user-ajeno';

  let service: UserRepresentationsService;
  let findMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      userRepresentation: { findMany },
    } as unknown as PrismaService;
    service = new UserRepresentationsService(prisma);
  });

  function user(role: AppRole, id: string): AuthenticatedUser {
    return { id, role, estateIds: [], administratorId: null };
  }

  describe('listActiveFor', () => {
    it('permite consultar las representaciones propias', async () => {
      await expect(service.listActiveFor(ME, user('C', ME))).resolves.toEqual(
        [],
      );
      expect(findMany).toHaveBeenCalled();
    });

    it('deniega consultar las de otro usuario', async () => {
      await expect(service.listActiveFor(OTHER, user('C', ME))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('no consulta la base de datos cuando deniega', async () => {
      await expect(
        service.listActiveFor(OTHER, user('C', ME)),
      ).rejects.toThrow();
      expect(findMany).not.toHaveBeenCalled();
    });

    it('tampoco deja al rol B husmear las de otros', async () => {
      await expect(service.listActiveFor(OTHER, user('B', ME))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('el rol A (plataforma) sí puede consultar las de cualquiera', async () => {
      await expect(
        service.listActiveFor(OTHER, user('A', ME)),
      ).resolves.toEqual([]);
    });
  });

  describe('canActOnBehalfOf', () => {
    it('permite preguntar por los poderes propios', async () => {
      await expect(
        service.canActOnBehalfOf(ME, OTHER, user('C', ME)),
      ).resolves.toBe(false);
    });

    it('deniega preguntar por los poderes de un tercero', async () => {
      // La respuesta revelaría si existe un apoderamiento entre dos personas.
      await expect(
        service.canActOnBehalfOf(OTHER, ME, user('C', ME)),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
