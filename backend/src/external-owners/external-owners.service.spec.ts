import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExternalOwnersService } from './external-owners.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const GESTORA: AuthenticatedUser = {
  id: 'b1',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'admin-1',
};
const OTRA_GESTORA: AuthenticatedUser = {
  id: 'b2',
  role: 'B',
  estateIds: ['e-otra'],
  administratorId: 'admin-2',
};

describe('ExternalOwnersService — alta/edición/baja manual', () => {
  let propertyFindFirst: jest.Mock;
  let ownerFindFirst: jest.Mock;
  let ownerCreate: jest.Mock;
  let ownerUpdate: jest.Mock;
  let ownerDelete: jest.Mock;
  let inviteDeleteMany: jest.Mock;
  let service: ExternalOwnersService;

  beforeEach(() => {
    propertyFindFirst = jest.fn().mockResolvedValue({ estateId: 'e1' });
    ownerFindFirst = jest.fn().mockResolvedValue({
      id: 'eo1',
      promotedToUserId: null,
      property: { estateId: 'e1' },
    });
    ownerCreate = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'eo-nuevo', ...data }),
      );
    ownerUpdate = jest.fn().mockResolvedValue({});
    ownerDelete = jest.fn().mockResolvedValue({});
    inviteDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      property: { findFirst: propertyFindFirst },
      externalOwner: {
        findFirst: ownerFindFirst,
        create: ownerCreate,
        update: ownerUpdate,
        delete: ownerDelete,
      },
      propertyMembershipInvite: { deleteMany: inviteDeleteMany },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    service = new ExternalOwnersService(prisma, new EstateAccessService());
  });

  describe('create', () => {
    it('crea el titular siempre como Propietario y registra quién lo dio de alta', async () => {
      await service.create(
        'p1',
        {
          fullName: 'Ana Titular',
          taxId: '12345678Z',
          email: 'ana@example.com',
        },
        GESTORA,
      );
      expect(ownerCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          propertyId: 'p1',
          fullName: 'Ana Titular',
          roleType: 'Propietario',
          createdByUserId: 'b1',
        }),
      });
    });

    it('rechaza una propiedad de una finca ajena', async () => {
      await expect(
        service.create('p1', { fullName: 'X' }, OTRA_GESTORA),
      ).rejects.toThrow(ForbiddenException);
      expect(ownerCreate).not.toHaveBeenCalled();
    });

    it('404 si la propiedad no existe o está borrada', async () => {
      propertyFindFirst.mockResolvedValue(null);
      await expect(
        service.create('p-borrada', { fullName: 'X' }, GESTORA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update / remove', () => {
    it('edita un titular no promovido de su finca', async () => {
      await service.update('eo1', { phone: '600000000', email: null }, GESTORA);
      expect(ownerUpdate).toHaveBeenCalledWith({
        where: { id: 'eo1' },
        data: { phone: '600000000', email: null },
      });
    });

    it('un titular ya promovido a usuario no se edita ni se borra (404: la búsqueda lo excluye)', async () => {
      ownerFindFirst.mockResolvedValue(null);
      await expect(
        service.update('eo1', { phone: '1' }, GESTORA),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove('eo1', GESTORA)).rejects.toThrow(
        NotFoundException,
      );
      expect(ownerFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'eo1', promotedToUserId: null },
        }),
      );
      expect(ownerUpdate).not.toHaveBeenCalled();
      expect(ownerDelete).not.toHaveBeenCalled();
    });

    it('una gestora ajena no puede borrarlo', async () => {
      await expect(service.remove('eo1', OTRA_GESTORA)).rejects.toThrow(
        ForbiddenException,
      );
      expect(ownerDelete).not.toHaveBeenCalled();
    });

    it('borra un titular de su finca', async () => {
      await service.remove('eo1', GESTORA);
      expect(ownerDelete).toHaveBeenCalledWith({ where: { id: 'eo1' } });
      // Sus invitaciones sin canjear se van con él (la FK es Restrict).
      expect(inviteDeleteMany).toHaveBeenCalledWith({
        where: { externalOwnerId: 'eo1', usedAt: null },
      });
    });
  });
});
