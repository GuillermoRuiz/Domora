/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import {
  NotificationsService,
  type NotifyInput,
} from './notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const USER: AuthenticatedUser = {
  id: 'u1',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'a1',
};

function input(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    userIds: ['staff-1'],
    category: 'adhesion',
    title: 'Nueva solicitud de adhesión',
    body: 'Ana quiere unirse',
    link: '/b/requests',
    estateId: 'e1',
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('NotificationsService', () => {
  let prisma: any;
  let mail: any;
  let config: any;
  let tasks: any;
  let push: any;
  let service: NotificationsService;

  beforeEach(() => {
    // Los fallos simulados se registran con Logger; no ensuciar la salida.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'staff-1', email: 'gestor@x.test', role: 'B' },
          ]),
      },
      userNotificationPreference: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest
          .fn()
          .mockImplementation(({ create }: any) => Promise.resolve(create)),
      },
      propertyMembership: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'n1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      directMessageParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      directMessage: { count: jest.fn().mockResolvedValue(0) },
      estate: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    mail = { sendNotificationEmail: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn().mockReturnValue('http://app.test,http://otra.test'),
    };
    tasks = { countPending: jest.fn().mockResolvedValue(0) };
    push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(prisma, mail, config, tasks, push);
  });

  describe('notify — gestora y soporte', () => {
    it('crea el aviso y envía el email con el enlace absoluto', async () => {
      await service.notify(input());

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'staff-1',
          category: 'adhesion',
          dedupeKey: null,
          title: 'Nueva solicitud de adhesión',
          body: 'Ana quiere unirse',
          link: '/b/requests',
          estateId: 'e1',
          propertyId: null,
        },
        select: { id: true },
      });
      expect(mail.sendNotificationEmail).toHaveBeenCalledWith(
        'gestor@x.test',
        'Nueva solicitud de adhesión',
        'Ana quiere unirse',
        'http://app.test/b/requests',
      );
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { emailStatus: 'sent', emailError: null },
      });
    });

    it('el enlace puede ser distinto por rol: cada destinatario recibe el de su árbol de rutas', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'staff-1', email: 'gestor@x.test', role: 'B' },
        { id: 'own-1', email: 'ana@x.test', role: 'C' },
      ]);

      await service.notify(
        input({
          userIds: ['staff-1', 'own-1'],
          link: { B: '/b/estates/e1?tab=juntas', C: '/c/alerts' },
        }),
      );

      expect(
        prisma.notification.create.mock.calls.map((c: any) => [
          c[0].data.userId,
          c[0].data.link,
        ]),
      ).toEqual([
        ['staff-1', '/b/estates/e1?tab=juntas'],
        ['own-1', '/c/alerts'],
      ]);
      expect(
        mail.sendNotificationEmail.mock.calls.map((c: any) => c[3]),
      ).toEqual([
        'http://app.test/b/estates/e1?tab=juntas',
        'http://app.test/c/alerts',
      ]);
    });

    it('si el rol del destinatario no está en el mapa de enlaces, usa el primero disponible', async () => {
      await service.notify(input({ link: { C: '/c/alerts' } }));

      expect(prisma.notification.create.mock.calls[0][0].data.link).toBe(
        '/c/alerts',
      );
    });

    it('con el email desactivado en sus preferencias: crea el aviso pero no envía nada', async () => {
      prisma.userNotificationPreference.findMany.mockResolvedValue([
        { userId: 'staff-1', emailEnabled: false },
      ]);

      await service.notify(input());

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('la preferencia se consulta para SU categoría', async () => {
      await service.notify(input({ category: 'inspection' }));

      expect(prisma.userNotificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['staff-1'] }, category: 'inspection' },
      });
    });

    it('si el email falla, lo deja registrado en el aviso y no lanza', async () => {
      mail.sendNotificationEmail.mockRejectedValue(new Error('SMTP caído'));

      await expect(service.notify(input())).resolves.toBeUndefined();

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: {
          emailStatus: 'failed',
          emailError: expect.stringContaining('SMTP caído'),
        },
      });
    });
  });

  describe('notify — propietarios (preferencia por vivienda)', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'own-1', email: 'ana@x.test', role: 'C' },
      ]);
    });

    function withSetting(notifyIssues: string | undefined) {
      prisma.propertyMembership.findMany.mockResolvedValue([
        {
          userId: 'own-1',
          propertyId: 'p1',
          settings: notifyIssues ? { notifyIssues } : null,
        },
      ]);
    }

    it.each([
      ['none', false, false],
      ['push_only', true, false],
      ['email_only', false, true],
      ['email_push', true, true],
    ])(
      'notifyIssues = %s → bandeja: %s, email: %s',
      async (setting, inApp, email) => {
        withSetting(setting);

        await service.notify(input({ userIds: ['own-1'], category: 'issue' }));

        expect(prisma.notification.create).toHaveBeenCalledTimes(inApp ? 1 : 0);
        expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(email ? 1 : 0);
      },
    );

    it('sin ajustes guardados usa el valor por defecto (bandeja + email)', async () => {
      withSetting(undefined);

      await service.notify(input({ userIds: ['own-1'], category: 'issue' }));

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
    });

    it('con varias viviendas basta con que UNA permita el canal (email)', async () => {
      prisma.propertyMembership.findMany.mockResolvedValue([
        {
          userId: 'own-1',
          propertyId: 'p1',
          settings: { notifyIssues: 'none' },
        },
        {
          userId: 'own-1',
          propertyId: 'p2',
          settings: { notifyIssues: 'email_only' },
        },
      ]);

      await service.notify(input({ userIds: ['own-1'], category: 'issue' }));

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
    });

    it('con varias viviendas basta con que UNA permita el canal (bandeja) — no hace falta que TODAS lo permitan', async () => {
      prisma.propertyMembership.findMany.mockResolvedValue([
        {
          userId: 'own-1',
          propertyId: 'p1',
          settings: { notifyIssues: 'none' },
        },
        {
          userId: 'own-1',
          propertyId: 'p2',
          settings: { notifyIssues: 'push_only' },
        },
      ]);

      await service.notify(input({ userIds: ['own-1'], category: 'issue' }));

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('si el aviso es de una vivienda concreta, solo cuenta la preferencia de ESA vivienda', async () => {
      withSetting('none');

      await service.notify(
        input({ userIds: ['own-1'], category: 'issue', propertyId: 'p9' }),
      );

      expect(prisma.propertyMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: 'p9',
            userId: { in: ['own-1'] },
          }),
        }),
      );
    });

    it('una categoría sin preferencia propia (adhesión) se entrega siempre y ni consulta membresías', async () => {
      await service.notify(input({ userIds: ['own-1'], category: 'adhesion' }));

      expect(prisma.propertyMembership.findMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
    });

    it('mensajes directos: usa notifyDirectMessages', async () => {
      prisma.propertyMembership.findMany.mockResolvedValue([
        {
          userId: 'own-1',
          propertyId: 'p1',
          settings: {
            notifyDirectMessages: 'none',
            notifyIssues: 'email_push',
          },
        },
      ]);

      await service.notify(
        input({ userIds: ['own-1'], category: 'direct_message' }),
      );

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('email_only: no hay fila en la bandeja pero el email sale igualmente (sin estado que actualizar)', async () => {
      withSetting('email_only');

      await service.notify(input({ userIds: ['own-1'], category: 'issue' }));

      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
      expect(prisma.notification.update).not.toHaveBeenCalled();
      // El push real viaja SOBRE la bandeja (inApp) — email_only no la activa, así que tampoco push.
      expect(push.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('notify — colapso (dedupeKey)', () => {
    it('si ya hay un aviso no leído con esa clave lo refresca: no crea otro y NO reenvía el email', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.notify(input({ dedupeKey: 'dm:c1' }));

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'staff-1', dedupeKey: 'dm:c1', readAt: null },
        data: expect.objectContaining({
          title: 'Nueva solicitud de adhesión',
          createdAt: expect.any(Date),
        }),
      });
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
      // Igual que el email: un colapso no reenvía el push real tampoco.
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('si no hay ninguno lo crea con la clave y sí envía el email y el push real', async () => {
      await service.notify(input({ dedupeKey: 'dm:c1' }));

      expect(prisma.notification.create.mock.calls[0][0].data.dedupeKey).toBe(
        'dm:c1',
      );
      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
      expect(push.sendToUser).toHaveBeenCalledWith('staff-1', {
        title: 'Nueva solicitud de adhesión',
        body: 'Ana quiere unirse',
        url: 'http://app.test/b/requests',
      });
    });

    it('carrera: si el índice único parcial rechaza el insert, refresca el que creó el otro proceso', async () => {
      prisma.notification.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.notification.create.mockRejectedValue(uniqueViolation());

      await service.notify(input({ dedupeKey: 'dm:c1' }));

      expect(prisma.notification.updateMany).toHaveBeenCalledTimes(2);
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('sin dedupeKey nunca intenta refrescar', async () => {
      await service.notify(input());

      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('notify — robustez', () => {
    it('nunca lanza: un fallo de base de datos se registra y ya', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('BD caída'));

      await expect(service.notify(input())).resolves.toBeUndefined();
    });

    it('el fallo con un destinatario no impide avisar a los demás', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'staff-1', email: 'a@x.test', role: 'B' },
        { id: 'staff-2', email: 'b@x.test', role: 'B' },
      ]);
      prisma.notification.create
        .mockRejectedValueOnce(new Error('falló el primero'))
        .mockResolvedValueOnce({ id: 'n2' });

      await service.notify(input({ userIds: ['staff-1', 'staff-2'] }));

      expect(mail.sendNotificationEmail).toHaveBeenCalledTimes(1);
      expect(mail.sendNotificationEmail.mock.calls[0][0]).toBe('b@x.test');
    });

    it('sin destinatarios no consulta nada', async () => {
      await service.notify(input({ userIds: [] }));

      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('deduplica destinatarios y descarta usuarios borrados', async () => {
      await service.notify(input({ userIds: ['staff-1', 'staff-1'] }));

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['staff-1'] }, deletedAt: null },
        select: { id: true, email: true, role: true },
      });
    });
  });

  describe('destinatarios habituales', () => {
    it('managerIdsOfEstate: rol B de la gestora que administra la finca', async () => {
      prisma.estate.findFirst.mockResolvedValue({ administratorId: 'a1' });
      prisma.user.findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

      await expect(service.managerIdsOfEstate('e1')).resolves.toEqual([
        'b1',
        'b2',
      ]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { administratorId: 'a1', role: 'B', deletedAt: null },
        select: { id: true },
      });
    });

    it('managerIdsOfEstate: finca inexistente → nadie', async () => {
      prisma.estate.findFirst.mockResolvedValue(null);

      await expect(service.managerIdsOfEstate('nope')).resolves.toEqual([]);
    });

    it('residentIds: propietarios e inquilinos vinculados, sin repetir usuario', async () => {
      prisma.propertyMembership.findMany.mockResolvedValue([{ userId: 'c1' }]);

      await expect(service.residentIds({ estateId: 'e1' })).resolves.toEqual([
        'c1',
      ]);
      expect(prisma.propertyMembership.findMany).toHaveBeenCalledWith({
        where: {
          status: 'linked',
          revokedAt: null,
          roleType: { in: ['Propietario', 'Inquilino'] },
          property: { deletedAt: null, estateId: 'e1' },
        },
        select: { userId: true },
        distinct: ['userId'],
      });
    });

    it('residentIds acota a una vivienda concreta', async () => {
      await service.residentIds({ propertyId: 'p1' });

      expect(
        prisma.propertyMembership.findMany.mock.calls[0][0].where.property,
      ).toEqual({
        deletedAt: null,
        id: 'p1',
      });
    });

    it('supportIds: usuarios rol A', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'a1' }]);

      await expect(service.supportIds()).resolves.toEqual(['a1']);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: 'A', deletedAt: null },
        select: { id: true },
      });
    });
  });

  describe('bandeja', () => {
    it('list: solo los del usuario, más recientes primero, con "read" como booleano', async () => {
      const readAt = new Date('2026-09-20T10:00:00Z');
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n1',
          category: 'adhesion',
          title: 't',
          body: null,
          link: '/l',
          estateId: 'e1',
          propertyId: null,
          readAt: null,
          createdAt: new Date('2026-09-21T10:00:00Z'),
        },
        {
          id: 'n2',
          category: 'issue',
          title: 't2',
          body: 'b',
          link: '/l2',
          estateId: null,
          propertyId: 'p1',
          readAt,
          createdAt: new Date('2026-09-20T09:00:00Z'),
        },
      ]);

      const items = await service.list(USER, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      expect(items.map((i) => [i.id, i.read])).toEqual([
        ['n1', false],
        ['n2', true],
      ]);
      expect(items[0].createdAt).toBe('2026-09-21T10:00:00.000Z');
      expect(items[0]).not.toHaveProperty('emailStatus');
    });

    it('list: filtro de no leídos, cursor por fecha y tope de página', async () => {
      await service.list(USER, {
        unread: true,
        before: '2026-09-20T00:00:00.000Z',
        limit: 999,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          readAt: null,
          createdAt: { lt: new Date('2026-09-20T00:00:00.000Z') },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('markRead: marca solo un aviso del propio usuario', async () => {
      prisma.notification.findFirst.mockResolvedValue({ readAt: null });

      await service.markRead(USER, 'n1');

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        select: { readAt: true },
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it('markRead: el aviso de OTRO usuario es un 404 (no se filtra que existe)', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead(USER, 'ajeno')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('markRead: si ya estaba leído no lo toca (conserva la fecha de lectura original)', async () => {
      prisma.notification.findFirst.mockResolvedValue({ readAt: new Date() });

      await service.markRead(USER, 'n1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('markAllRead: solo los no leídos del usuario', async () => {
      await service.markAllRead(USER);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('summary', () => {
    it('reúne avisos sin leer, mensajes sin leer y tareas pendientes', async () => {
      prisma.notification.count.mockResolvedValue(4);
      prisma.directMessageParticipant.findMany.mockResolvedValue([
        { conversationId: 'c1', lastReadAt: null },
        { conversationId: 'c2', lastReadAt: new Date('2026-09-20T00:00:00Z') },
      ]);
      prisma.directMessage.count.mockResolvedValue(3);
      tasks.countPending.mockResolvedValue(7);

      await expect(service.summary(USER)).resolves.toEqual({
        unreadNotifications: 4,
        unreadMessages: 3,
        pendingTasks: 7,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: null },
      });
    });

    it('los mensajes sin leer se cuentan en UNA consulta para todas las conversaciones', async () => {
      const lastReadAt = new Date('2026-09-20T00:00:00Z');
      prisma.directMessageParticipant.findMany.mockResolvedValue([
        { conversationId: 'c1', lastReadAt: null },
        { conversationId: 'c2', lastReadAt },
      ]);

      await service.summary(USER);

      expect(prisma.directMessage.count).toHaveBeenCalledTimes(1);
      expect(prisma.directMessage.count).toHaveBeenCalledWith({
        where: {
          senderId: { not: 'u1' },
          OR: [
            { conversationId: 'c1', createdAt: { gt: new Date(0) } },
            { conversationId: 'c2', createdAt: { gt: lastReadAt } },
          ],
        },
      });
    });

    it('sin conversaciones no llega a contar mensajes (un OR vacío no filtraría nada)', async () => {
      await service.summary(USER);

      expect(prisma.directMessage.count).not.toHaveBeenCalled();
    });
  });

  describe('preferencias de email', () => {
    it('getPreferences devuelve TODAS las categorías, activadas si no hay fila', async () => {
      prisma.userNotificationPreference.findMany.mockResolvedValue([
        { category: 'inspection', emailEnabled: false },
      ]);

      const prefs = await service.getPreferences(USER);

      expect(prefs.find((p) => p.category === 'inspection')?.emailEnabled).toBe(
        false,
      );
      expect(
        prefs
          .filter((p) => p.category !== 'inspection')
          .every((p) => p.emailEnabled),
      ).toBe(true);
      expect(prefs.map((p) => p.category)).toEqual(
        expect.arrayContaining([
          'adhesion',
          'onboarding',
          'issue',
          'direct_message',
          'inspection',
          'meeting',
        ]),
      );
    });

    it('updatePreferences hace upsert por (usuario, categoría) y devuelve el estado resultante', async () => {
      await service.updatePreferences(USER, {
        preferences: [{ category: 'meeting', emailEnabled: false }],
      });

      expect(prisma.userNotificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId_category: { userId: 'u1', category: 'meeting' } },
        update: { emailEnabled: false },
        create: { userId: 'u1', category: 'meeting', emailEnabled: false },
      });
      expect(prisma.userNotificationPreference.findMany).toHaveBeenCalled();
    });
  });

  it('deleteReadBefore borra solo los leídos anteriores a la fecha y devuelve cuántos', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 5 });
    const cutoff = new Date('2026-06-01T00:00:00Z');

    await expect(service.deleteReadBefore(cutoff)).resolves.toBe(5);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { readAt: { lt: cutoff } },
    });
  });
});
