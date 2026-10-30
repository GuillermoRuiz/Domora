/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const OWNER: AuthenticatedUser = {
  id: 'owner-1',
  role: 'C',
  estateIds: [],
  administratorId: null,
};

const CREATE_DTO = { type: 'Piso', roleType: 'Propietario' } as any;

describe('PropertiesService — avisos', () => {
  let prisma: any;
  let tx: any;
  let notifications: any;
  let service: PropertiesService;

  beforeEach(() => {
    tx = {
      property: { create: jest.fn().mockResolvedValue({ id: 'p-new' }) },
      propertyMembership: { create: jest.fn().mockResolvedValue({}) },
      adhesionRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      estate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'e1', name: 'Edificio Sol' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Ana García' }),
      },
      property: { findFirst: jest.fn() },
      estateOnboardingRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      managerIdsOfEstate: jest.fn().mockResolvedValue(['b1', 'b2']),
      supportIds: jest.fn().mockResolvedValue(['a1']),
    };
    service = new PropertiesService(
      prisma,
      new EstateAccessService(),
      {} as any,
      notifications,
      {} as any,
    );
  });

  describe('create — solicitud de adhesión', () => {
    it('avisa al equipo de la gestora de la finca, con el nombre del solicitante y enlace a sus solicitudes', async () => {
      await service.create({ ...CREATE_DTO, estateId: 'e1' }, OWNER);

      expect(notifications.managerIdsOfEstate).toHaveBeenCalledWith('e1');
      expect(notifications.notify).toHaveBeenCalledWith({
        userIds: ['b1', 'b2'],
        category: 'adhesion',
        title: 'Nueva solicitud de adhesión',
        body: 'Ana García solicita unirse a Edificio Sol.',
        link: '/b/estates/e1?tab=requests',
        estateId: 'e1',
        propertyId: 'p-new',
      });
    });

    it('el aviso se emite DESPUÉS de confirmar la transacción (no avisa de algo que puede deshacerse)', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(
        async (fn: (t: unknown) => unknown) => {
          const result = await fn(tx);
          order.push('commit');
          return result;
        },
      );
      notifications.notify.mockImplementation(async () => {
        order.push('notify');
      });

      await service.create({ ...CREATE_DTO, estateId: 'e1' }, OWNER);

      expect(order).toEqual(['commit', 'notify']);
    });

    it('una propiedad privada (sin finca) no avisa a nadie', async () => {
      await service.create(CREATE_DTO, OWNER);

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(tx.adhesionRequest.create).not.toHaveBeenCalled();
    });

    it('finca inexistente → 404 y no se crea ni se avisa de nada', async () => {
      prisma.estate.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...CREATE_DTO, estateId: 'nope' }, OWNER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('devuelve la propiedad creada', async () => {
      await expect(
        service.create({ ...CREATE_DTO, estateId: 'e1' }, OWNER),
      ).resolves.toEqual({ id: 'p-new' });
    });
  });

  describe('createOnboardingRequest — alta de comunidad nueva', () => {
    it('avisa al equipo de soporte con el nombre de la comunidad', async () => {
      await service.createOnboardingRequest(
        { communityName: 'Residencial Luna' } as any,
        OWNER,
      );

      expect(notifications.notify).toHaveBeenCalledWith({
        userIds: ['a1'],
        category: 'onboarding',
        title: 'Nueva solicitud de alta de comunidad',
        body: 'Residencial Luna',
        link: '/a/admins',
      });
    });

    it('devuelve la solicitud creada', async () => {
      await expect(
        service.createOnboardingRequest(
          { communityName: 'Residencial Luna' } as any,
          OWNER,
        ),
      ).resolves.toEqual({ id: 'r1' });
    });
  });
});
