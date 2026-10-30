/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AgendaTasksService } from './agenda-tasks.service';
import { AgendaTaskLinksService } from './agenda-task-links.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const ESTATE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ESTATE = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const ISSUE_ID = '77777777-7777-4777-8777-777777777777';

function manager(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: USER_ID,
    role: 'B',
    estateIds: [ESTATE],
    administratorId: ADMIN,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): any {
  return {
    id: TASK_ID,
    administratorId: ADMIN,
    estateId: ESTATE,
    title: 'Llamar al proveedor del ascensor',
    description: null,
    assignedToUserId: USER_ID,
    createdByUserId: USER_ID,
    type: 'LLAMADA',
    priority: 'ALTA',
    status: 'PENDIENTE',
    startAt: new Date('2026-10-14T09:00:00Z'),
    endAt: new Date('2026-10-14T10:00:00Z'),
    allDay: false,
    timezone: 'Europe/Madrid',
    reminderMinutesBefore: null,
    reminderSentForStart: null,
    recurrenceFreq: null,
    recurrenceInterval: 1,
    recurrenceUntil: null,
    source: 'manual',
    sourceRef: null,
    estate: { id: ESTATE, name: 'Residencial San Miguel' },
    assignedTo: { id: USER_ID, fullName: 'Laura Martínez' },
    labels: [],
    occurrences: [],
    checklist: [],
    links: [],
    _count: { comments: 0, attachments: 0, links: 0 },
    ...overrides,
  };
}

describe('AgendaTasksService', () => {
  let prisma: any;
  let audit: { logAccess: jest.Mock };
  let storage: { delete: jest.Mock };
  let service: AgendaTasksService;

  beforeEach(() => {
    prisma = {
      agendaTask: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: TASK_ID }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      agendaTaskOccurrence: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agendaTaskAttachment: { findMany: jest.fn().mockResolvedValue([]) },
      agendaTaskChecklistItem: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      agendaTaskLabel: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      issue: { findMany: jest.fn().mockResolvedValue([]) },
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => await fn(prisma)),
    };
    audit = { logAccess: jest.fn().mockResolvedValue(undefined) };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    service = new AgendaTasksService(
      prisma,
      new EstateAccessService(),
      audit as any,
      new AgendaTaskLinksService(prisma),
      storage as any,
    );
  });

  const baseCreate = {
    title: 'Revisar contrato',
    startAt: '2026-10-14T09:00:00.000Z',
    endAt: '2026-10-14T10:00:00.000Z',
  };

  describe('aislamiento multi-tenant', () => {
    it('un usuario sin gestora no puede consultar ni crear nada', async () => {
      const orphan = manager({ administratorId: null });
      await expect(
        service.list(orphan, {
          from: '2026-10-12T00:00:00Z',
          to: '2026-10-19T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.create(baseCreate as any, orphan),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.agendaTask.findMany).not.toHaveBeenCalled();
    });

    it('la consulta de calendario se acota SIEMPRE a la gestora y a sus comunidades', async () => {
      await service.list(manager(), {
        from: '2026-10-12T00:00:00Z',
        to: '2026-10-19T00:00:00Z',
      });

      const { where } = prisma.agendaTask.findMany.mock.calls[0][0];
      expect(where.AND[0]).toEqual({
        administratorId: ADMIN,
        archivedAt: null,
        OR: [{ estateId: null }, { estateId: { in: [ESTATE] } }],
      });
    });

    it('filtrar por una comunidad ajena se rechaza con 403', async () => {
      await expect(
        service.list(manager(), {
          from: '2026-10-12T00:00:00Z',
          to: '2026-10-19T00:00:00Z',
          estateId: FOREIGN_ESTATE,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.agendaTask.findMany).not.toHaveBeenCalled();
    });

    it('crear una tarea en una comunidad ajena se rechaza con 403', async () => {
      await expect(
        service.create(
          { ...baseCreate, estateId: FOREIGN_ESTATE } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.agendaTask.create).not.toHaveBeenCalled();
    });

    it('no se puede asignar a alguien fuera del equipo de la gestora', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { ...baseCreate, assignedToUserId: OTHER_ADMIN } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: OTHER_ADMIN,
          administratorId: ADMIN,
          role: 'B',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.agendaTask.create).not.toHaveBeenCalled();
    });

    it('no se pueden usar etiquetas de otra gestora', async () => {
      prisma.agendaTaskLabel.count.mockResolvedValue(0);

      await expect(
        service.create(
          { ...baseCreate, labelIds: [OTHER_ADMIN] } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.agendaTaskLabel.count).toHaveBeenCalledWith({
        where: { id: { in: [OTHER_ADMIN] }, administratorId: ADMIN },
      });
    });

    it('no se puede vincular una entidad de una comunidad no accesible', async () => {
      prisma.issue.findMany.mockResolvedValue([
        {
          id: ISSUE_ID,
          ref: 'INC-1',
          title: 'Fuga',
          property: { estateId: FOREIGN_ESTATE },
        },
      ]);

      await expect(
        service.create(
          { ...baseCreate, links: [{ type: 'issue', id: ISSUE_ID }] } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.agendaTask.create).not.toHaveBeenCalled();
    });

    it('una entidad vinculada debe ser de la misma comunidad que la tarea', async () => {
      const second = '88888888-8888-4888-8888-888888888888';
      prisma.issue.findMany.mockResolvedValue([
        {
          id: ISSUE_ID,
          ref: 'INC-1',
          title: 'Fuga',
          property: { estateId: second },
        },
      ]);

      await expect(
        service.create(
          {
            ...baseCreate,
            estateId: ESTATE,
            links: [{ type: 'issue', id: ISSUE_ID }],
          } as any,
          manager({ estateIds: [ESTATE, second] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una tarea de otra gestora responde 404 (no 403) y no se filtra su existencia', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(null);

      await expect(service.getById(TASK_ID, manager())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const { where } = prisma.agendaTask.findFirst.mock.calls[0][0];
      expect(where.AND[1].administratorId).toBe(ADMIN);
    });

    it('editar, completar, duplicar y borrar parten del mismo ámbito', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(null);
      const user = manager();

      await expect(
        service.update(TASK_ID, { title: 'x' }, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.updateStatus(TASK_ID, { status: 'COMPLETADA' }, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.duplicate(TASK_ID, user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove(TASK_ID, user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.agendaTask.update).not.toHaveBeenCalled();
      expect(prisma.agendaTask.delete).not.toHaveBeenCalled();
    });

    it('un id que no es UUID es 404 sin llegar a la base de datos', async () => {
      await expect(
        service.getById('no-uuid', manager()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agendaTask.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('consulta por rango', () => {
    it('exige ambos límites y un rango razonable', async () => {
      await expect(
        service.list(manager(), { from: '2026-10-12T00:00:00Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.list(manager(), {
          from: '2026-10-19T00:00:00Z',
          to: '2026-10-12T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.list(manager(), {
          from: '2026-01-01T00:00:00Z',
          to: '2027-01-01T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.agendaTask.findMany).not.toHaveBeenCalled();
    });

    it('la lista sin rango solo trae trabajo ABIERTO y con tope (nunca el histórico)', async () => {
      await service.list(manager(), { overdue: 'true', limit: 50 });

      const args = prisma.agendaTask.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.where.AND).toContainEqual({
        status: { in: ['PENDIENTE', 'EN_CURSO', 'EN_ESPERA'] },
      });
    });

    it('rechaza valores de filtro desconocidos', async () => {
      await expect(
        service.list(manager(), {
          from: '2026-10-12T00:00:00Z',
          to: '2026-10-19T00:00:00Z',
          priority: 'URGENTE,INVENTADA',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('expande una serie semanal en una ocurrencia por semana', async () => {
      prisma.agendaTask.findMany.mockResolvedValueOnce([
        row({ recurrenceFreq: 'WEEKLY', recurrenceInterval: 1 }),
      ]);

      const { items } = await service.list(manager(), {
        from: '2026-10-12T00:00:00Z',
        to: '2026-11-02T00:00:00Z',
      });

      // 09:00Z = 11:00 en Madrid (CEST). El 25-oct se retrasa la hora, así que
      // la ocurrencia del 28-oct sigue siendo a las 11:00 locales = 10:00Z.
      expect(items.map((i) => i.occurrenceStart)).toEqual([
        '2026-10-14T09:00:00.000Z',
        '2026-10-21T09:00:00.000Z',
        '2026-10-28T10:00:00.000Z',
      ]);
      expect(new Set(items.map((i) => i.occurrenceKey)).size).toBe(3);
      expect(items.every((i) => i.recurring && i.id === TASK_ID)).toBe(true);
    });

    it('una ocurrencia completada no arrastra al resto de la serie', async () => {
      prisma.agendaTask.findMany.mockResolvedValueOnce([
        row({
          recurrenceFreq: 'WEEKLY',
          occurrences: [
            {
              occurrenceStart: new Date('2026-10-21T09:00:00Z'),
              status: 'COMPLETADA',
            },
          ],
        }),
      ]);

      const { items } = await service.list(manager(), {
        from: '2026-10-12T00:00:00Z',
        to: '2026-11-02T00:00:00Z',
      });

      expect(items.map((i) => i.status)).toEqual([
        'PENDIENTE',
        'COMPLETADA',
        'PENDIENTE',
      ]);
    });

    it('"vencida" se calcula: terminó y no está resuelta', async () => {
      prisma.agendaTask.findMany.mockResolvedValueOnce([
        row({
          id: 'a',
          startAt: new Date('2020-01-01T09:00:00Z'),
          endAt: new Date('2020-01-01T10:00:00Z'),
        }),
        row({
          id: 'b',
          status: 'COMPLETADA',
          startAt: new Date('2020-01-01T09:00:00Z'),
          endAt: new Date('2020-01-01T10:00:00Z'),
        }),
        row({
          id: 'c',
          status: 'CANCELADA',
          startAt: new Date('2020-01-01T09:00:00Z'),
          endAt: new Date('2020-01-01T10:00:00Z'),
        }),
        row({
          id: 'd',
          startAt: new Date('2099-01-01T09:00:00Z'),
          endAt: new Date('2099-01-01T10:00:00Z'),
        }),
      ]);

      const { items } = await service.list(manager(), {
        from: '2019-12-30T00:00:00Z',
        to: '2020-01-05T00:00:00Z',
      });
      // El mock devuelve las 4 filas; solo las que solapan con el rango salen.
      expect(items.map((i) => [i.id, i.overdue])).toEqual([
        ['a', true],
        ['b', false],
        ['c', false],
      ]);
    });
  });

  describe('estados', () => {
    it('una tarea simple no admite resolver "ocurrencias"', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(row());

      await expect(
        service.updateStatus(
          TASK_ID,
          { status: 'COMPLETADA', occurrenceStart: '2026-10-14T09:00:00.000Z' },
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completar una ocurrencia de una serie crea una excepción y no toca la serie', async () => {
      prisma.agendaTask.findFirst
        .mockResolvedValueOnce(row({ recurrenceFreq: 'WEEKLY' })) // findScoped
        .mockResolvedValueOnce(
          row({
            recurrenceFreq: 'WEEKLY',
            links: [],
            comments: [],
            attachments: [],
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ); // getById

      await service.updateStatus(
        TASK_ID,
        { status: 'COMPLETADA', occurrenceStart: '2026-10-21T09:00:00.000Z' },
        manager(),
      );

      expect(prisma.agendaTaskOccurrence.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.agendaTask.update).not.toHaveBeenCalled();
      expect(audit.logAccess).toHaveBeenCalledWith(
        expect.anything(),
        'agenda_task',
        'complete',
        TASK_ID,
        expect.any(String),
      );
    });

    it('rechaza una fecha que no es ninguna ocurrencia de la serie', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(
        row({ recurrenceFreq: 'WEEKLY' }),
      );

      await expect(
        service.updateStatus(
          TASK_ID,
          { status: 'COMPLETADA', occurrenceStart: '2026-10-22T09:00:00.000Z' },
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.agendaTaskOccurrence.upsert).not.toHaveBeenCalled();
    });

    it('completar una tarea simple fija completedAt y la audita', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(
        row({
          links: [],
          comments: [],
          attachments: [],
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.updateStatus(TASK_ID, { status: 'COMPLETADA' }, manager());

      const { data } = prisma.agendaTask.update.mock.calls[0][0];
      expect(data.status).toBe('COMPLETADA');
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.cancelledAt).toBeNull();
    });
  });

  describe('validación de fechas', () => {
    it('rechaza una tarea que termina antes de empezar', async () => {
      await expect(
        service.create(
          {
            ...baseCreate,
            startAt: '2026-10-14T10:00:00.000Z',
            endAt: '2026-10-14T09:00:00.000Z',
          } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una zona horaria desconocida', async () => {
      await expect(
        service.create(
          { ...baseCreate, timezone: 'Marte/Olympus' } as any,
          manager(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una tarea de día completo se normaliza a medianoches UTC con fin exclusivo', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(
        row({
          links: [],
          comments: [],
          attachments: [],
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.create(
        {
          title: 'Revisar contrato de mantenimiento',
          startAt: '2026-10-14T13:45:00.000Z',
          endAt: '2026-10-14T13:45:00.000Z',
          allDay: true,
        },
        manager(),
      );

      const { data } = prisma.agendaTask.create.mock.calls[0][0];
      expect(data.startAt.toISOString()).toBe('2026-10-14T00:00:00.000Z');
      expect(data.endAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect(data.allDay).toBe(true);
    });

    it('registra quién crea la tarea y la audita', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(
        row({
          links: [],
          comments: [],
          attachments: [],
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.create(baseCreate, manager());

      const { data } = prisma.agendaTask.create.mock.calls[0][0];
      expect(data.administratorId).toBe(ADMIN);
      expect(data.createdByUserId).toBe(USER_ID);
      expect(data.priority).toBe('MEDIA');
      expect(data.status).toBe('PENDIENTE');
      expect(audit.logAccess).toHaveBeenCalledWith(
        expect.anything(),
        'agenda_task',
        'create',
        TASK_ID,
        'Revisar contrato',
      );
    });
  });

  describe('borrado', () => {
    it('borra la tarea, audita y retira los ficheros adjuntos', async () => {
      prisma.agendaTask.findFirst.mockResolvedValue(
        row({ links: [], labels: [] }),
      );
      prisma.agendaTaskAttachment.findMany.mockResolvedValue([
        { s3Key: 'agenda-tasks/x/a.pdf' },
      ]);

      await service.remove(TASK_ID, manager());

      expect(prisma.agendaTask.delete).toHaveBeenCalledWith({
        where: { id: TASK_ID },
      });
      expect(storage.delete).toHaveBeenCalledWith('agenda-tasks/x/a.pdf');
      expect(audit.logAccess).toHaveBeenCalledWith(
        expect.anything(),
        'agenda_task',
        'delete',
        TASK_ID,
        expect.any(String),
      );
    });
  });

  describe('etiquetas', () => {
    it('borrar una etiqueta ajena es 404', async () => {
      prisma.agendaTaskLabel.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteLabel(TASK_ID, manager()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agendaTaskLabel.deleteMany).toHaveBeenCalledWith({
        where: { id: TASK_ID, administratorId: ADMIN },
      });
    });
  });
});
