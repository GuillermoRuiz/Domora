import { InspectionsCronService } from './inspections-cron.service';

// En UTC, no en hora local del entorno donde corre el test — el servicio
// (InspectionsCronService.startOfDay) compara en UTC, así que el fixture
// tiene que construirse igual para que la prueba no dependa del TZ de quien
// la ejecuta.
function daysFromNow(days: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
}

describe('InspectionsCronService', () => {
  let prisma: any;
  let notifications: any;
  let service: InspectionsCronService;

  beforeEach(() => {
    prisma = {
      regulatoryInspection: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    notifications = {
      managerIdsOfEstate: jest.fn().mockResolvedValue(['b1']),
      notify: jest.fn().mockResolvedValue(undefined),
    };
    service = new InspectionsCronService(prisma, notifications);
  });

  describe('markOverdue', () => {
    it('pasa a vencida solo planificada/citada con fecha límite ya pasada', async () => {
      await service.run();
      expect(prisma.regulatoryInspection.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['planificada', 'citada'] },
          nextDueDate: { lt: expect.any(Date) },
        },
        data: { status: 'vencida' },
      });
    });
  });

  describe('sendReminders', () => {
    it('avisa al equipo (rol B) de la gestora si la fecha límite cae dentro de la ventana de aviso', async () => {
      prisma.regulatoryInspection.findMany.mockResolvedValue([
        {
          id: 'insp-1',
          estateId: 'estate-1',
          nextDueDate: daysFromNow(10),
          reminderDaysBefore: 30,
          lastReminderSentAt: null,
          asset: { name: 'Ascensor' },
          inspectionType: { name: 'Ascensores — ITC AEM 1' },
        },
      ]);

      await service.run();

      expect(notifications.managerIdsOfEstate).toHaveBeenCalledWith('estate-1');
      expect(notifications.notify).toHaveBeenCalledWith({
        userIds: ['b1'],
        category: 'inspection',
        title: 'Ascensores — ITC AEM 1 próxima a vencer',
        body: expect.stringContaining('vence en 10 días'),
        link: '/b/estates/estate-1?tab=inspections',
        estateId: 'estate-1',
      });
      expect(prisma.regulatoryInspection.update).toHaveBeenCalledWith({
        where: { id: 'insp-1' },
        data: { lastReminderSentAt: expect.any(Date) },
      });
    });

    it('vence mañana usa el texto singular en vez de "en 1 días"', async () => {
      prisma.regulatoryInspection.findMany.mockResolvedValue([
        {
          id: 'insp-1',
          estateId: 'estate-1',
          nextDueDate: daysFromNow(1),
          reminderDaysBefore: 30,
          lastReminderSentAt: null,
          asset: { name: 'Ascensor' },
          inspectionType: { name: 'Ascensores' },
        },
      ]);

      await service.run();

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('vence mañana'),
        }),
      );
    });

    it('NO avisa si la fecha límite está fuera de la ventana de reminderDaysBefore', async () => {
      prisma.regulatoryInspection.findMany.mockResolvedValue([
        {
          id: 'insp-1',
          estateId: 'estate-1',
          nextDueDate: daysFromNow(60),
          reminderDaysBefore: 30,
          lastReminderSentAt: null,
          asset: { name: 'Ascensor' },
          inspectionType: { name: 'Ascensores' },
        },
      ]);

      await service.run();

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(prisma.regulatoryInspection.update).not.toHaveBeenCalled();
    });

    it('NO reenvía si ya se avisó hoy (idempotencia entre pasadas del cron o varias réplicas)', async () => {
      prisma.regulatoryInspection.findMany.mockResolvedValue([
        {
          id: 'insp-1',
          estateId: 'estate-1',
          nextDueDate: daysFromNow(10),
          reminderDaysBefore: 30,
          lastReminderSentAt: new Date(),
          asset: { name: 'Ascensor' },
          inspectionType: { name: 'Ascensores' },
        },
      ]);

      await service.run();

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
