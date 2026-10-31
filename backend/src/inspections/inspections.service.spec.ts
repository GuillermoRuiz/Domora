import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

function user(
  role: AppRole,
  estateIds: string[] = ['estate-1'],
): AuthenticatedUser {
  return { id: 'user-1', role, estateIds, administratorId: 'admin-1' };
}

const baseInspection = {
  id: 'insp-1',
  estateId: 'estate-1',
  assetId: 'asset-1',
  inspectionTypeId: 'type-1',
  status: 'planificada',
  nextDueDate: null,
  appointmentDate: null,
  lastDoneDate: null,
  reminderDaysBefore: 30,
  lastReminderSentAt: null,
  notes: null,
  createdByUserId: 'user-1',
};

const detailPayload = {
  ...baseInspection,
  asset: { id: 'asset-1', name: 'Ascensor principal' },
  inspectionType: { id: 'type-1', name: 'Ascensores — ITC AEM 1' },
  results: [],
  correctiveActions: [],
};

describe('InspectionsService', () => {
  let prisma: any;
  let notifications: any;
  let storage: any;
  let service: InspectionsService;
  let txRegulatoryInspectionUpdate: jest.Mock;
  let txActivityLogCreate: jest.Mock;

  beforeEach(() => {
    txRegulatoryInspectionUpdate = jest.fn().mockResolvedValue(detailPayload);
    txActivityLogCreate = jest.fn().mockResolvedValue({});
    const txInspectionResultCreate = jest
      .fn()
      .mockResolvedValue({ id: 'result-1' });

    const tx = {
      regulatoryInspection: {
        create: jest.fn().mockResolvedValue(detailPayload),
        update: txRegulatoryInspectionUpdate,
      },
      activityLogEntry: { create: txActivityLogCreate },
      inspectionResult: { create: txInspectionResultCreate },
    };

    prisma = {
      regulatoryInspection: {
        findUnique: jest.fn().mockResolvedValue(baseInspection),
        findMany: jest.fn().mockResolvedValue([]),
      },
      asset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'asset-1',
          name: 'Ascensor principal',
          estateId: 'estate-1',
        }),
      },
      correctiveAction: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      inspectionResult: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };

    notifications = {
      residentIds: jest.fn().mockResolvedValue([]),
      notify: jest.fn().mockResolvedValue(undefined),
    };
    storage = { get: jest.fn() };

    const estateAccess = new EstateAccessService();

    service = new InspectionsService(
      prisma as PrismaService,
      estateAccess,
      storage,
      notifications,
    );
  });

  describe('update — aviso de cita a inquilinos/propietarios', () => {
    it('avisa a los residentes de la finca (dedupados por NotificationsService) cuando pasa a citada con fecha de cita', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'citada',
        appointmentDate: new Date('2026-10-01'),
      });
      notifications.residentIds.mockResolvedValue(['own-1', 'own-2']);

      await service.update(
        'insp-1',
        { status: 'citada', appointmentDate: '2026-10-01' } as any,
        user('B'),
      );

      expect(notifications.residentIds).toHaveBeenCalledWith({
        estateId: 'estate-1',
      });
      expect(notifications.notify).toHaveBeenCalledWith({
        userIds: ['own-1', 'own-2'],
        category: 'inspection',
        title: 'Inspección programada: Ascensor principal',
        body: expect.stringContaining('Ascensor principal'),
        link: '/c/alerts',
        estateId: 'estate-1',
      });
    });

    it('NO avisa si el cambio de estado no es a citada', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'realizada',
      });

      await service.update('insp-1', { status: 'realizada' } as any, user('B'));

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('NO avisa si pasa a citada pero sin appointmentDate (ni en el dto ni ya existente)', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'citada',
      });

      await service.update('insp-1', { status: 'citada' } as any, user('B'));

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('appointmentDate: null borra la cita: no se usa la anterior ni se avisa a los residentes', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue({
        ...baseInspection,
        appointmentDate: new Date('2026-10-01'),
      });
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'citada',
        appointmentDate: null,
      });

      await service.update(
        'insp-1',
        { status: 'citada', appointmentDate: null } as any,
        user('B'),
      );

      expect(
        txRegulatoryInspectionUpdate.mock.calls[0][0].data.appointmentDate,
      ).toBeNull();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('rechaza si el usuario es rol C (solo la gestora gestiona inspecciones)', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      await expect(
        service.update('insp-1', { notes: 'x' } as any, user('C')),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addResult — cierre de ciclo según el resultado', () => {
    it('favorable pasa la inspección a "realizada"', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'realizada',
      });

      await service.addResult(
        'insp-1',
        { date: '2026-09-01', outcome: 'favorable' } as any,
        null,
        user('B'),
      );

      expect(txRegulatoryInspectionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'realizada' }),
        }),
      );
    });

    it('desfavorable pasa la inspección a "desfavorable"', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(baseInspection);
      txRegulatoryInspectionUpdate.mockResolvedValue({
        ...detailPayload,
        status: 'desfavorable',
      });

      await service.addResult(
        'insp-1',
        { date: '2026-09-01', outcome: 'desfavorable' } as any,
        null,
        user('B'),
      );

      expect(txRegulatoryInspectionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'desfavorable' }),
        }),
      );
    });
  });

  describe('assertAccess — nunca se confía en el estateId sin comprobar', () => {
    it('rechaza el acceso a una inspección de una finca ajena', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue({
        ...baseInspection,
        estateId: 'estate-otra',
      });
      await expect(
        service.findById('insp-1', user('B', ['estate-1'])),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si la inspección no existe', async () => {
      prisma.regulatoryInspection.findUnique.mockResolvedValue(null);
      await expect(service.findById('insp-x', user('B'))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('rechaza si el activo no pertenece a la finca indicada', async () => {
      prisma.asset.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          'estate-1',
          { assetId: 'asset-otra', inspectionTypeId: 'type-1' } as any,
          user('B'),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
