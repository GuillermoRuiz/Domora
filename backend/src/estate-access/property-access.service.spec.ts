import { ForbiddenException } from '@nestjs/common';
import { PropertyAccessService } from './property-access.service';
import { EstateAccessService } from './estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

/**
 * Único sitio del código que decide "esta propiedad es del usuario que
 * pregunta" — lo usan `PropertiesService`, `LedgerReportsService` (extracto
 * por propiedad, fase 12) y `DebtorsService` (certificado de deuda). El
 * rol C nunca lleva `propertyIds` en el JWT, así que esto SIEMPRE consulta
 * la base de datos; A y B ni la tocan (van por `EstateAccessService`, solo
 * el JWT). Ver memoria discovery_property_scope_leak.md para el hallazgo
 * real que motivó extraer esta clase.
 */
describe('PropertyAccessService', () => {
  const PROPERTY = {
    id: 'prop-1',
    estateId: 'estate-1',
    primaryUserId: 'owner-1',
  };

  function user(
    role: AppRole,
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser {
    return {
      id: 'user-1',
      role,
      estateIds: ['estate-1'],
      administratorId: role === 'B' ? 'admin-1' : null,
      ...overrides,
    };
  }

  function serviceWith(membership: unknown = null) {
    const findFirst = jest.fn().mockResolvedValue(membership);
    const prisma = {
      propertyMembership: { findFirst },
    } as unknown as PrismaService;
    return {
      service: new PropertyAccessService(prisma, new EstateAccessService()),
      findFirst,
    };
  }

  it('rol A siempre pasa, sin consultar PropertyMembership', async () => {
    const { service, findFirst } = serviceWith();
    await expect(
      service.assertAccess(PROPERTY, user('A', { estateIds: [] })),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rol B pasa si tiene acceso a la finca, por EstateAccessService', async () => {
    const { service, findFirst } = serviceWith();
    await expect(
      service.assertAccess(PROPERTY, user('B')),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rol B de OTRA finca es rechazado, sin consultar PropertyMembership', async () => {
    const { service, findFirst } = serviceWith();
    await expect(
      service.assertAccess(PROPERTY, user('B', { estateIds: ['otra-finca'] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rol C que es el creador (primaryUserId) pasa sin consultar PropertyMembership', async () => {
    const { service, findFirst } = serviceWith();
    await expect(
      service.assertAccess(PROPERTY, user('C', { id: 'owner-1' })),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rol C con una PropertyMembership vinculada pasa', async () => {
    const { service } = serviceWith({
      id: 'm1',
      status: 'linked',
      revokedAt: null,
    });
    await expect(
      service.assertAccess(PROPERTY, user('C', { id: 'tenant-1' })),
    ).resolves.toBeUndefined();
  });

  it('rol C sin relación con la propiedad es rechazado, aunque comparta finca', async () => {
    const { service } = serviceWith(null);
    await expect(
      service.assertAccess(PROPERTY, user('C', { id: 'vecino-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una propiedad sin primaryUserId (alta hecha por la gestora) sigue exigiendo la membresía', async () => {
    const managed = { ...PROPERTY, primaryUserId: null };
    const { service, findFirst } = serviceWith({
      id: 'm1',
      status: 'linked',
      revokedAt: null,
    });
    await expect(
      service.assertAccess(managed, user('C', { id: 'tenant-1' })),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        propertyId: 'prop-1',
        userId: 'tenant-1',
        status: 'linked',
        revokedAt: null,
      },
    });
  });

  it('canAccess aplica el MISMO criterio que assertAccess, sin lanzar', async () => {
    const linked = serviceWith({ id: 'm1', status: 'linked', revokedAt: null });
    await expect(
      linked.service.canAccess(PROPERTY, user('C', { id: 'tenant-1' })),
    ).resolves.toBe(true);
    await expect(
      linked.service.canAccess(PROPERTY, user('C', { id: 'owner-1' })),
    ).resolves.toBe(true);
    await expect(
      serviceWith(null).service.canAccess(
        PROPERTY,
        user('C', { id: 'vecino-1' }),
      ),
    ).resolves.toBe(false);
    await expect(
      serviceWith().service.canAccess(PROPERTY, user('B')),
    ).resolves.toBe(true);
    await expect(
      serviceWith().service.canAccess(
        PROPERTY,
        user('B', { estateIds: ['otra'] }),
      ),
    ).resolves.toBe(false);
  });

  it('ownedPropertiesWhere: A y B no se restringen por propiedad; C, solo titular o membresía vinculada y no revocada', () => {
    const { service } = serviceWith();
    expect(service.ownedPropertiesWhere(user('A'))).toBeNull();
    expect(service.ownedPropertiesWhere(user('B'))).toBeNull();
    expect(service.ownedPropertiesWhere(user('C', { id: 'u-c' }))).toEqual({
      OR: [
        { primaryUserId: 'u-c' },
        {
          memberships: {
            some: { userId: 'u-c', status: 'linked', revokedAt: null },
          },
        },
      ],
    });
  });

  describe('isActiveMember · miembro activo de una comunidad (incidencias de zona común)', () => {
    it('rol C: consulta la base de datos (membresía vinculada, no revocada, de una propiedad no dada de baja de ESA finca)', async () => {
      const { service, findFirst } = serviceWith({ id: 'm1' });
      await expect(
        service.isActiveMember('estate-1', user('C', { id: 'vecino-1' })),
      ).resolves.toBe(true);
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'vecino-1',
          status: 'linked',
          revokedAt: null,
          property: { estateId: 'estate-1', deletedAt: null },
        },
        select: { id: true },
      });
    });

    it('rol C sin esa membresía (revocada, pendiente, otra finca, propiedad borrada) no es miembro, aunque su JWT lleve la finca', async () => {
      const { service } = serviceWith(null);
      await expect(
        service.isActiveMember(
          'estate-1',
          user('C', { id: 'vecino-1', estateIds: ['estate-1'] }),
        ),
      ).resolves.toBe(false);
    });

    it('A y B van por finca y no consultan la base de datos', async () => {
      const { service, findFirst } = serviceWith();
      await expect(
        service.isActiveMember('estate-1', user('A', { estateIds: [] })),
      ).resolves.toBe(true);
      await expect(service.isActiveMember('estate-1', user('B'))).resolves.toBe(
        true,
      );
      await expect(
        service.isActiveMember('estate-1', user('B', { estateIds: ['otra'] })),
      ).resolves.toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('FALLA CERRADO: sin finca nadie es miembro (EstateAccessService.canAccess(null) sería true)', async () => {
      const { service, findFirst } = serviceWith({ id: 'm1' });
      for (const role of ['A', 'B', 'C'] as const) {
        await expect(service.isActiveMember(null, user(role))).resolves.toBe(
          false,
        );
        await expect(
          service.isActiveMember(undefined, user(role)),
        ).resolves.toBe(false);
      }
      expect(findFirst).not.toHaveBeenCalled();
    });
  });
});
