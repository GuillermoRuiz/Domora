/* eslint-disable @typescript-eslint/no-explicit-any */
import { TasksService } from './tasks.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function manager(estateIds: string[] = ['e1', 'e2']): AuthenticatedUser {
  return { id: 'b1', role: 'B', estateIds, administratorId: 'a1' };
}

function daysFromNow(days: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
}

describe('TasksService', () => {
  let prisma: any;
  let service: TasksService;

  beforeEach(() => {
    prisma = {
      estateOnboardingRequest: { count: jest.fn().mockResolvedValue(0) },
      adhesionRequest: { groupBy: jest.fn().mockResolvedValue([]) },
      issue: { findMany: jest.fn().mockResolvedValue([]) },
      regulatoryInspection: { findMany: jest.fn().mockResolvedValue([]) },
      correctiveAction: { findMany: jest.fn().mockResolvedValue([]) },
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      estate: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', name: 'Edificio Sol' },
          { id: 'e2', name: 'Bloque Luna' },
        ]),
      },
    };
    service = new TasksService(prisma);
  });

  it('un propietario (rol C) no tiene tareas de gestión y no consulta nada', async () => {
    const owner: AuthenticatedUser = {
      id: 'c1',
      role: 'C',
      estateIds: ['e1'],
      administratorId: null,
    };

    await expect(service.list(owner)).resolves.toEqual([]);
    expect(prisma.adhesionRequest.groupBy).not.toHaveBeenCalled();
  });

  describe('soporte (rol A)', () => {
    const support: AuthenticatedUser = {
      id: 'a1',
      role: 'A',
      estateIds: [],
      administratorId: null,
    };

    it('solo ve las altas de comunidad pendientes', async () => {
      prisma.estateOnboardingRequest.count.mockResolvedValue(3);

      await expect(service.list(support)).resolves.toEqual([
        {
          kind: 'onboarding_requests',
          estateId: null,
          estateName: null,
          title: '3 solicitudes de alta de comunidad',
          count: 3,
          link: '/a/admins',
        },
      ]);
      expect(prisma.estateOnboardingRequest.count).toHaveBeenCalledWith({
        where: { status: 'pending' },
      });
      expect(prisma.adhesionRequest.groupBy).not.toHaveBeenCalled();
    });

    it('sin pendientes no hay tareas, y una sola va en singular', async () => {
      await expect(service.list(support)).resolves.toEqual([]);

      prisma.estateOnboardingRequest.count.mockResolvedValue(1);
      const [task] = await service.list(support);
      expect(task.title).toBe('1 solicitud de alta de comunidad');
    });
  });

  describe('gestora (rol B)', () => {
    it('sin fincas asignadas no consulta nada', async () => {
      await expect(service.list(manager([]))).resolves.toEqual([]);
      expect(prisma.adhesionRequest.groupBy).not.toHaveBeenCalled();
    });

    it('acota TODAS las consultas a las fincas del usuario', async () => {
      await service.list(manager(['e1']));

      const scope = { in: ['e1'] };
      expect(
        prisma.adhesionRequest.groupBy.mock.calls[0][0].where.estateId,
      ).toEqual(scope);
      expect(prisma.issue.findMany.mock.calls[0][0].where.estateId).toEqual(
        scope,
      );
      expect(
        prisma.regulatoryInspection.findMany.mock.calls[0][0].where.estateId,
      ).toEqual(scope);
      expect(
        prisma.correctiveAction.findMany.mock.calls[0][0].where.inspection
          .estateId,
      ).toEqual(scope);
      expect(prisma.meeting.findMany.mock.calls[0][0].where.estateId).toEqual(
        scope,
      );
      expect(prisma.estate.findMany.mock.calls[0][0].where.id).toEqual(scope);
    });

    it('solicitudes de adhesión: una fila por finca, con enlace a su pestaña', async () => {
      prisma.adhesionRequest.groupBy.mockResolvedValue([
        { estateId: 'e1', _count: { _all: 2 } },
        { estateId: 'e2', _count: { _all: 1 } },
      ]);

      const tasks = await service.list(manager());

      expect(tasks).toEqual([
        {
          kind: 'adhesion_requests',
          estateId: 'e2',
          estateName: 'Bloque Luna',
          title: '1 solicitud de adhesión pendiente',
          count: 1,
          link: '/b/estates/e2?tab=requests',
        },
        {
          kind: 'adhesion_requests',
          estateId: 'e1',
          estateName: 'Edificio Sol',
          title: '2 solicitudes de adhesión pendientes',
          count: 2,
          link: '/b/estates/e1?tab=requests',
        },
      ]);
    });

    it('incidencias sin atender: cuenta las Abiertas por finca, ignorando viviendas sin finca', async () => {
      prisma.issue.findMany.mockResolvedValue([
        { estateId: 'e1' },
        { estateId: 'e1' },
        { estateId: null },
      ]);

      const [task] = await service.list(manager());

      expect(prisma.issue.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'Abierta',
        deletedAt: null,
      });
      expect(task).toMatchObject({
        kind: 'issues_open',
        estateId: 'e1',
        count: 2,
        link: '/b/estates/e1?tab=issues',
      });
    });

    it('inspecciones: distingue vencidas (incluida una con fecha pasada que el cron aún no ha marcado) de las próximas a vencer', async () => {
      prisma.regulatoryInspection.findMany.mockResolvedValue([
        { estateId: 'e1', status: 'vencida', nextDueDate: daysFromNow(-10) },
        { estateId: 'e1', status: 'planificada', nextDueDate: daysFromNow(-1) }, // vencida de facto
        { estateId: 'e1', status: 'citada', nextDueDate: daysFromNow(10) },
        { estateId: 'e2', status: 'planificada', nextDueDate: daysFromNow(0) }, // vence hoy: aún no vencida
      ]);

      const tasks = await service.list(manager());

      expect(tasks.filter((t) => t.kind === 'inspections_overdue')).toEqual([
        expect.objectContaining({
          estateId: 'e1',
          count: 2,
          title: '2 inspecciones vencidas',
          link: '/b/estates/e1?tab=inspections',
        }),
      ]);
      expect(
        tasks
          .filter((t) => t.kind === 'inspections_due_soon')
          .map((t) => [t.estateId, t.count]),
      ).toEqual([
        ['e2', 1],
        ['e1', 1],
      ]);
    });

    it('la consulta de inspecciones trae las vencidas y las que vencen dentro de 30 días', async () => {
      await service.list(manager());

      const where = prisma.regulatoryInspection.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toEqual({ status: 'vencida' });
      expect(where.OR[1].status).toEqual({ in: ['planificada', 'citada'] });
      const limit = where.OR[1].nextDueDate.lte as Date;
      expect(limit.getTime()).toBe(daysFromNow(30).getTime());
    });

    it('acciones correctivas vencidas y juntas pendientes de cerrar', async () => {
      prisma.correctiveAction.findMany.mockResolvedValue([
        { inspection: { estateId: 'e1' } },
      ]);
      prisma.meeting.findMany.mockResolvedValue([
        { estateId: 'e1' },
        { estateId: 'e1' },
      ]);

      const tasks = await service.list(manager());

      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'corrective_actions_overdue',
            count: 1,
            title: '1 acción correctiva vencida',
          }),
          expect.objectContaining({
            kind: 'meetings_to_close',
            count: 2,
            title: '2 juntas pendientes de cerrar',
            link: '/b/estates/e1?tab=juntas',
          }),
        ]),
      );
      expect(prisma.meeting.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'convocada',
        scheduledAt1: { lt: expect.any(Date) },
      });
    });

    it('descarta las fincas que ya no existen (borradas) aunque haya datos', async () => {
      prisma.adhesionRequest.groupBy.mockResolvedValue([
        { estateId: 'e-borrada', _count: { _all: 1 } },
      ]);

      await expect(service.list(manager(['e-borrada']))).resolves.toEqual([]);
    });

    it('ordena por prioridad de tipo y luego por nombre de finca', async () => {
      prisma.adhesionRequest.groupBy.mockResolvedValue([
        { estateId: 'e1', _count: { _all: 1 } },
      ]);
      prisma.issue.findMany.mockResolvedValue([{ estateId: 'e2' }]);
      prisma.meeting.findMany.mockResolvedValue([{ estateId: 'e1' }]);

      const kinds = (await service.list(manager())).map((t) => t.kind);

      expect(kinds).toEqual([
        'adhesion_requests',
        'meetings_to_close',
        'issues_open',
      ]);
    });

    it('countPending suma los recuentos de todas las tareas', async () => {
      prisma.adhesionRequest.groupBy.mockResolvedValue([
        { estateId: 'e1', _count: { _all: 2 } },
      ]);
      prisma.issue.findMany.mockResolvedValue([{ estateId: 'e2' }]);

      await expect(service.countPending(manager())).resolves.toBe(3);
    });
  });
});
