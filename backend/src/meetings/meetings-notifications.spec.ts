/* eslint-disable @typescript-eslint/no-explicit-any */
import { MeetingsService } from './meetings.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const MANAGER: AuthenticatedUser = {
  id: 'b1',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'a1',
};

const MEETING = {
  id: 'm1',
  estateId: 'e1',
  status: 'convocada',
  title: 'Junta Ordinaria 2026',
  scheduledAt1: new Date('2020-01-01'),
};

describe('MeetingsService.updateStatus — avisa al cerrar la junta', () => {
  let prisma: any;
  let notifications: any;
  let service: MeetingsService;

  beforeEach(() => {
    const tx = {
      meeting: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...MEETING, status: 'celebrada' }),
      },
      activityLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      meeting: { findFirst: jest.fn().mockResolvedValue(MEETING) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      managerIdsOfEstate: jest.fn().mockResolvedValue(['b1', 'b2']),
      residentIds: jest.fn().mockResolvedValue(['own-1']),
    };
    service = new MeetingsService(
      prisma,
      new EstateAccessService(),
      { get: () => 'http://app.test' } as any,
      {} as any,
      {} as any,
      {} as any,
      notifications,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('celebrada: avisa a gestora Y residentes, con enlaces distintos por rol', async () => {
    prisma.meeting.findFirst.mockResolvedValue({
      ...MEETING,
      scheduledAt1: new Date('2020-01-01'),
    });

    await service.updateStatus('m1', { status: 'celebrada' } as any, MANAGER);

    expect(notifications.managerIdsOfEstate).toHaveBeenCalledWith('e1');
    expect(notifications.residentIds).toHaveBeenCalledWith({ estateId: 'e1' });
    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['b1', 'b2', 'own-1'],
      category: 'meeting',
      title: 'Junta celebrada: Junta Ordinaria 2026',
      link: { B: '/b/estates/e1?tab=juntas', C: '/c/juntas?estateId=e1&meeting=m1' },
      estateId: 'e1',
    });
  });

  it('cancelada: mismo aviso, pero con el título de cancelación', async () => {
    const tx = {
      meeting: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...MEETING, status: 'cancelada' }),
      },
      activityLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((fn: (t: unknown) => unknown) => fn(tx));

    await service.updateStatus('m1', { status: 'cancelada' } as any, MANAGER);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Junta cancelada: Junta Ordinaria 2026',
      }),
    );
  });

  it('el aviso se emite DESPUÉS de confirmar el cambio de estado', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(
      async (fn: (t: unknown) => unknown) => {
        const result = await fn({
          meeting: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue({ ...MEETING, status: 'celebrada' }),
          },
          activityLogEntry: { create: jest.fn().mockResolvedValue({}) },
        });
        order.push('commit');
        return result;
      },
    );
    notifications.notify.mockImplementation(async () => {
      order.push('notify');
    });

    await service.updateStatus('m1', { status: 'celebrada' } as any, MANAGER);

    expect(order).toEqual(['commit', 'notify']);
  });

  it('un doble cierre concurrente (updateMany count 0) no llega a avisar', async () => {
    const tx = {
      meeting: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLogEntry: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (t: unknown) => unknown) => fn(tx));

    await expect(
      service.updateStatus('m1', { status: 'celebrada' } as any, MANAGER),
    ).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
