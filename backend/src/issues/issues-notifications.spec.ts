/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssuesService } from './issues.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const MANAGER: AuthenticatedUser = {
  id: 'b1',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'a1',
};

const ISSUE = {
  id: 'issue-1',
  estateId: 'e1',
  title: 'Fuga en el techo',
};

describe('IssuesService.sendNotification — avisos reales (no solo histórico)', () => {
  let prisma: any;
  let notifications: any;
  let service: IssuesService;

  beforeEach(() => {
    prisma = {
      issue: { findFirst: jest.fn().mockResolvedValue(ISSUE) },
      issueReport: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { reporterUserId: 'own-1' },
            { reporterUserId: 'own-2' },
            { reporterUserId: 'own-1' },
          ]),
      },
      issueNotification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    service = new IssuesService(
      prisma,
      new EstateAccessService(),
      notifications,
    );
  });

  it('registra el histórico Y avisa de verdad a quienes reportaron la incidencia (sin repetir)', async () => {
    await service.sendNotification(
      'issue-1',
      { recipientsCount: 2, channel: 'email', subject: 'Reparación en curso' },
      MANAGER,
    );

    expect(prisma.issueNotification.create).toHaveBeenCalledWith({
      data: {
        issueId: 'issue-1',
        sentAt: expect.any(Date),
        recipientsCount: 2,
        channel: 'email',
        sentByUserId: 'b1',
        subject: 'Reparación en curso',
        body: null,
      },
    });
    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['own-1', 'own-2'],
      category: 'issue',
      title: 'Reparación en curso',
      body: null,
      link: '/c/incidencias?issue=issue-1',
    });
  });

  it('sin asunto, usa un título genérico con el nombre de la incidencia', async () => {
    await service.sendNotification(
      'issue-1',
      { recipientsCount: 1, channel: 'push' },
      MANAGER,
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Actualización de la incidencia: Fuga en el techo',
      }),
    );
  });

  it('un asunto en blanco cae también al título genérico', async () => {
    await service.sendNotification(
      'issue-1',
      { recipientsCount: 1, channel: 'push', subject: '   ' },
      MANAGER,
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Actualización de la incidencia: Fuga en el techo',
      }),
    );
  });

  it('devuelve la entrada de histórico creada (contrato que ya consume el frontend)', async () => {
    await expect(
      service.sendNotification(
        'issue-1',
        { recipientsCount: 1, channel: 'email' },
        MANAGER,
      ),
    ).resolves.toEqual({ id: 'n1' });
  });

  it('una incidencia de otra finca es 403 y no llega a avisar', async () => {
    prisma.issue.findFirst.mockResolvedValue({
      ...ISSUE,
      estateId: 'e-otra',
    });

    await expect(
      service.sendNotification(
        'issue-1',
        { recipientsCount: 1, channel: 'email' },
        MANAGER,
      ),
    ).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('una incidencia inexistente es 404 y no llega a avisar', async () => {
    prisma.issue.findFirst.mockResolvedValue(null);

    await expect(
      service.sendNotification(
        'issue-1',
        { recipientsCount: 1, channel: 'email' },
        MANAGER,
      ),
    ).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
