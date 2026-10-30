import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PropertyMembershipsService } from './property-memberships.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

const PROPERTY_ID = 'property-1';
const ESTATE_ID = 'estate-1';
const PRIMARY_MEMBERSHIP_ID = 'membership-primary';
const OTHER_MEMBERSHIP_ID = 'membership-other';

function user(role: AppRole, id = 'user-1', estateIds: string[] = [ESTATE_ID]): AuthenticatedUser {
  return { id, role, estateIds, administratorId: 'admin-1' };
}

function property(overrides: Partial<{ id: string; estateId: string | null }> = {}) {
  return { id: PROPERTY_ID, estateId: ESTATE_ID, deletedAt: null, ...overrides };
}

describe('PropertyMembershipsService', () => {
  let service: PropertyMembershipsService;
  let propertyFindFirst: jest.Mock;
  let membershipFindFirst: jest.Mock;
  let membershipCount: jest.Mock;
  let membershipUpdate: jest.Mock;
  let activityLogCreate: jest.Mock;

  beforeEach(() => {
    propertyFindFirst = jest.fn().mockResolvedValue(property());
    membershipFindFirst = jest.fn();
    membershipCount = jest.fn().mockResolvedValue(2);
    membershipUpdate = jest.fn().mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, roleType: 'Inquilino', ...data }),
    );
    activityLogCreate = jest.fn().mockResolvedValue({});

    const tx = {
      propertyMembership: { update: membershipUpdate },
      activityLogEntry: { create: activityLogCreate },
    };

    const prisma = {
      property: { findFirst: propertyFindFirst },
      propertyMembership: {
        findFirst: membershipFindFirst,
        count: membershipCount,
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    service = new PropertyMembershipsService(prisma, new EstateAccessService());
  });

  describe('assertCanManageMembers', () => {
    it('permite al rol A sin ser miembro de la propiedad', async () => {
      membershipFindFirst.mockResolvedValue(null);
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('A', 'soporte', [])),
      ).resolves.toEqual(property());
    });

    it('permite al rol B con acceso a la finca de la propiedad', async () => {
      membershipFindFirst.mockResolvedValue(null);
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('B')),
      ).resolves.toEqual(property());
    });

    it('deniega al rol B sin acceso a esa finca', async () => {
      membershipFindFirst.mockResolvedValue(null);
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('B', 'otro-admin', ['otra-finca'])),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite al primary contact activo de la propiedad (rol C)', async () => {
      membershipFindFirst.mockResolvedValue({ id: PRIMARY_MEMBERSHIP_ID });
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('C')),
      ).resolves.toEqual(property());
    });

    it('deniega a un rol C que no es primary contact de esa propiedad', async () => {
      membershipFindFirst.mockResolvedValue(null);
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('C')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si la propiedad no existe', async () => {
      propertyFindFirst.mockResolvedValue(null);
      await expect(
        service.assertCanManageMembers(PROPERTY_ID, user('A', 'soporte', [])),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revoke', () => {
    function mockAuthorizedPrimaryContact() {
      membershipFindFirst.mockImplementation(({ where }: any) => {
        if (where.isPrimaryContact) return Promise.resolve({ id: PRIMARY_MEMBERSHIP_ID });
        if (where.id === OTHER_MEMBERSHIP_ID) {
          return Promise.resolve({ id: OTHER_MEMBERSHIP_ID, isPrimaryContact: false, roleType: 'Inquilino' });
        }
        return Promise.resolve(null);
      });
    }

    it('revoca una membresía no-primaria cuando la pide el primary contact', async () => {
      mockAuthorizedPrimaryContact();
      const result = await service.revoke(PROPERTY_ID, OTHER_MEMBERSHIP_ID, user('C'));
      expect(result).toMatchObject({ id: OTHER_MEMBERSHIP_ID, status: 'revoked' });
      expect(activityLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subjectType: 'membership' }) }),
      );
    });

    it('revoca una membresía cuando la pide un rol B con acceso a la finca', async () => {
      membershipFindFirst.mockImplementation(({ where }: any) => {
        if (where.id === OTHER_MEMBERSHIP_ID) {
          return Promise.resolve({ id: OTHER_MEMBERSHIP_ID, isPrimaryContact: false, roleType: 'Inquilino' });
        }
        return Promise.resolve(null);
      });
      const result = await service.revoke(PROPERTY_ID, OTHER_MEMBERSHIP_ID, user('B'));
      expect(result).toMatchObject({ id: OTHER_MEMBERSHIP_ID, status: 'revoked' });
    });

    it('rechaza revocar si es la única membresía linked que queda', async () => {
      mockAuthorizedPrimaryContact();
      membershipCount.mockResolvedValue(1);
      await expect(
        service.revoke(PROPERTY_ID, OTHER_MEMBERSHIP_ID, user('C')),
      ).rejects.toThrow(ConflictException);
      expect(membershipUpdate).not.toHaveBeenCalled();
    });

    it('rechaza revocar al único primary contact sin indicar a quién promover', async () => {
      membershipFindFirst.mockImplementation(({ where }: any) => {
        if (where.isPrimaryContact) return Promise.resolve({ id: PRIMARY_MEMBERSHIP_ID });
        if (where.id === PRIMARY_MEMBERSHIP_ID) {
          return Promise.resolve({ id: PRIMARY_MEMBERSHIP_ID, isPrimaryContact: true, roleType: 'Propietario' });
        }
        return Promise.resolve(null);
      });
      await expect(
        service.revoke(PROPERTY_ID, PRIMARY_MEMBERSHIP_ID, user('C')),
      ).rejects.toThrow(ConflictException);
      expect(membershipUpdate).not.toHaveBeenCalled();
    });

    it('promueve a otro miembro y revoca al primary contact cuando se indica promoteMembershipId', async () => {
      membershipFindFirst.mockImplementation(({ where }: any) => {
        if (where.isPrimaryContact) return Promise.resolve({ id: PRIMARY_MEMBERSHIP_ID });
        if (where.id === PRIMARY_MEMBERSHIP_ID) {
          return Promise.resolve({ id: PRIMARY_MEMBERSHIP_ID, isPrimaryContact: true, roleType: 'Propietario' });
        }
        if (where.id === OTHER_MEMBERSHIP_ID && where.status === 'linked') {
          return Promise.resolve({ id: OTHER_MEMBERSHIP_ID });
        }
        return Promise.resolve(null);
      });

      const result = await service.revoke(PROPERTY_ID, PRIMARY_MEMBERSHIP_ID, user('C'), OTHER_MEMBERSHIP_ID);

      expect(membershipUpdate).toHaveBeenCalledWith({
        where: { id: OTHER_MEMBERSHIP_ID },
        data: { isPrimaryContact: true },
      });
      expect(result).toMatchObject({ id: PRIMARY_MEMBERSHIP_ID, status: 'revoked' });
    });

    it('lanza NotFoundException si la membresía a revocar no existe en la propiedad', async () => {
      membershipFindFirst.mockResolvedValue(null);
      await expect(
        service.revoke(PROPERTY_ID, 'membership-inexistente', user('A', 'soporte', [])),
      ).rejects.toThrow(NotFoundException);
    });

    it('deniega revocar a quien no tiene acceso a la propiedad', async () => {
      await expect(
        service.revoke(PROPERTY_ID, OTHER_MEMBERSHIP_ID, user('B', 'otro-admin', ['otra-finca'])),
      ).rejects.toThrow(ForbiddenException);
      expect(membershipUpdate).not.toHaveBeenCalled();
    });
  });
});
