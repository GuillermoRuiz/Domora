/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException } from '@nestjs/common';
import { AdhesionRequestsService } from './adhesion-requests.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const MANAGER: AuthenticatedUser = {
  id: 'b1',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'a1',
};

const PENDING = {
  id: 'r1',
  estateId: 'e1',
  propertyId: 'p1',
  userId: 'owner-1',
  roleType: 'Propietario',
  status: 'pending',
};

describe('AdhesionRequestsService — avisos al solicitante', () => {
  let prisma: any;
  let tx: any;
  let notifications: any;
  let service: AdhesionRequestsService;

  beforeEach(() => {
    tx = {
      adhesionRequest: {
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'rejected' }),
      },
      estate: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ administratorId: 'a1', name: 'Edificio Sol' }),
      },
      property: { update: jest.fn().mockResolvedValue({}) },
      propertyMembership: {
        upsert: jest.fn().mockResolvedValue({ id: 'm1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Ana García' }),
      },
      activityLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      adhesionRequest: { findFirst: jest.fn().mockResolvedValue(PENDING) },
      estate: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Edificio Sol' }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new AdhesionRequestsService(
      prisma,
      new EstateAccessService(),
      notifications,
    );
  });

  it('aprobar avisa al solicitante con el nombre de la comunidad y enlace a su propiedad', async () => {
    await service.approve('r1', MANAGER);

    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['owner-1'],
      category: 'adhesion',
      title: 'Solicitud de adhesión aprobada',
      body: 'Ya formas parte de la comunidad de Edificio Sol.',
      link: '/c/properties/p1',
      estateId: 'e1',
      propertyId: 'p1',
    });
  });

  it('aprobar devuelve la membresía y avisa solo tras confirmar la transacción', async () => {
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

    await expect(service.approve('r1', MANAGER)).resolves.toEqual({ id: 'm1' });
    expect(order).toEqual(['commit', 'notify']);
  });

  it('rechazar avisa al solicitante y lo lleva a «Mi comunidad» (no a las incidencias)', async () => {
    await service.reject('r1', MANAGER, 'no consta en el registro');

    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['owner-1'],
      category: 'adhesion',
      title: 'Solicitud de adhesión rechazada',
      body: 'La gestora ha rechazado tu solicitud de Edificio Sol.',
      link: '/c/community',
      estateId: 'e1',
      propertyId: 'p1',
    });
  });

  it('rechazar devuelve la solicitud actualizada', async () => {
    await expect(service.reject('r1', MANAGER)).resolves.toEqual({
      id: 'r1',
      status: 'rejected',
    });
  });

  it('una solicitud ya resuelta no se puede resolver de nuevo y no avisa a nadie', async () => {
    prisma.adhesionRequest.findFirst.mockResolvedValue({
      ...PENDING,
      status: 'approved',
    });

    await expect(service.reject('r1', MANAGER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('si la transacción falla no se avisa de una decisión que no llegó a aplicarse', async () => {
    prisma.$transaction.mockRejectedValue(new Error('BD caída'));

    await expect(service.reject('r1', MANAGER)).rejects.toThrow('BD caída');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('un gestor de otra finca no puede resolverla ni provoca avisos', async () => {
    const other: AuthenticatedUser = { ...MANAGER, estateIds: ['e-otra'] };

    await expect(service.approve('r1', other)).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
