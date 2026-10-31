import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Communication } from '../prisma/client';
import { ResourcesService } from './resources.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';

/**
 * Cubre solo lo nuevo del tablón de anuncios (autoría, matriz de
 * autorización, traza de edición de admin, archivado calculado sin CRON).
 * `resources.service.ts` no tenía ningún spec antes de esto — no se hace
 * backfill del resto del servicio (documentos, alertas, actividad), solo se
 * ajustan las dos aserciones de `where` en alertas que este cambio toca.
 */

const ESTATE = 'estate-1';

const DISPLAY_NAMES: Record<string, string> = {
  'admin-1': 'Gestora Admin',
  'vecino-1': 'Vecino Uno',
  'vecino-2': 'Vecino Dos',
};

function user(
  role: AppRole,
  id: string,
  estateIds: string[] = [ESTATE],
): AuthenticatedUser {
  return { id, role, estateIds, administratorId: 'gestora-1' };
}

function makeCommunication(
  overrides: Partial<Communication> = {},
): Communication {
  return {
    id: 'comm-1',
    estateId: ESTATE,
    title: 'Corte de agua',
    body: 'El jueves se corta el agua de 9 a 13h.',
    date: new Date('2026-08-01T10:00:00Z'),
    from: 'Gestora Admin',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    authorUserId: 'admin-1',
    deletedAt: null,
    archivedByAdmin: false,
    activeUntil: null,
    lastEditedByUserId: null,
    lastEditedAt: null,
    category: 'General',
    targetPropertyId: null,
    pinnedAt: null,
    isLegalNotice: false,
    legalNoticeSignerRole: null,
    legalNoticeSignerName: null,
    legalNoticeReason: null,
    legalNoticeCountersignedByPresident: false,
    ...overrides,
  } as Communication;
}

interface PrismaMock {
  communication: {
    count: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  communicationReply: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  communicationAttachment: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  propertyMembership: { findMany: jest.Mock };
  property: { findFirst: jest.Mock };
  user: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
  activityLogEntry: { create: jest.Mock };
  resourceRead: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

/** El aviso por email es fire-and-forget (`void`) — deja pasar un tick real para que su promesa corra. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

describe('ResourcesService — comunicados (tablón de anuncios)', () => {
  let prisma: PrismaMock;
  let notifications: { notify: jest.Mock };
  let service: ResourcesService;

  beforeEach(() => {
    prisma = {
      communication: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      communicationReply: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      communicationAttachment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      propertyMembership: { findMany: jest.fn().mockResolvedValue([]) },
      property: { findFirst: jest.fn() },
      user: {
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { id: { in: string[] } } }) =>
              Promise.resolve(
                where.id.in
                  .filter((id) => DISPLAY_NAMES[id])
                  .map((id) => ({ id, fullName: DISPLAY_NAMES[id] })),
              ),
          ),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ fullName: 'Gestora Admin' }),
      },
      activityLogEntry: { create: jest.fn().mockResolvedValue({}) },
      resourceRead: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: (tx: PrismaMock) => unknown) => cb(prisma)),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ResourcesService(
      prisma as unknown as PrismaService,
      new EstateAccessService(),
      { get: () => 'http://localhost:4200' } as any,
      {} as any,
      notifications as any,
      new RagAuthorizationService(prisma as unknown as PrismaService),
    );
  });

  describe('createCommunication', () => {
    it('permite que rol C publique — el bloqueo explícito por rol se elimina', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        fullName: 'Vecino Uno',
      });
      prisma.communication.create.mockResolvedValue(
        makeCommunication({ authorUserId: 'vecino-1', from: 'Vecino Uno' }),
      );

      await expect(
        service.createCommunication(
          ESTATE,
          {
            title: 'Se busca gato perdido',
            body: 'Blanco y negro, edificio B.',
          },
          user('C', 'vecino-1'),
        ),
      ).resolves.toMatchObject({ authorUserId: 'vecino-1' });
    });

    it('el "from" y el autor siempre se derivan del usuario autenticado, nunca de lo que mande el cliente', async () => {
      prisma.communication.create.mockResolvedValue(makeCommunication());

      await service.createCommunication(
        ESTATE,
        { title: 'x', body: 'y' },
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communication.create.mock.calls[0];
      expect(data.from).toBe('Gestora Admin');
      expect(data.authorUserId).toBe('admin-1');
    });

    it('rechaza una fecha de vigencia en el pasado', async () => {
      await expect(
        service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', activeUntil: '2020-01-01T00:00:00Z' },
          user('B', 'admin-1'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });

    describe('aviso (bandeja + email) — solo Urgente/notificación legal', () => {
      it('un comunicado Urgente avisa a todos los destinatarios elegibles de la finca', async () => {
        prisma.communication.create.mockResolvedValue(
          makeCommunication({ category: 'Urgente', title: 'Corte de agua' }),
        );
        prisma.propertyMembership.findMany.mockResolvedValue([
          { userId: 'vecino-1' },
          { userId: 'vecino-2' },
        ]);

        await service.createCommunication(
          ESTATE,
          { title: 'Corte de agua', body: 'y', category: 'Urgente' },
          user('B', 'admin-1'),
        );
        await settle();

        expect(prisma.propertyMembership.findMany).toHaveBeenCalledWith({
          where: {
            status: 'linked',
            revokedAt: null,
            property: { estateId: ESTATE },
          },
          select: { userId: true },
          distinct: ['userId'],
        });
        expect(notifications.notify).toHaveBeenCalledWith({
          userIds: ['vecino-1', 'vecino-2'],
          category: 'communication',
          title: 'Aviso urgente: Corte de agua',
          body: 'El jueves se corta el agua de 9 a 13h.',
          link: `/c/community?tab=communications&estateId=${ESTATE}`,
          estateId: ESTATE,
          propertyId: null,
        });
      });

      it('una notificación fehaciente usa el título correspondiente', async () => {
        prisma.communication.create.mockResolvedValue(
          makeCommunication({ isLegalNotice: true }),
        );
        prisma.propertyMembership.findMany.mockResolvedValue([
          { userId: 'vecino-1' },
        ]);

        await service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', isLegalNotice: true },
          user('B', 'admin-1'),
        );
        await settle();

        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Notificación fehaciente: Corte de agua',
          }),
        );
      });

      it('un comunicado General NO avisa a nadie', async () => {
        prisma.communication.create.mockResolvedValue(
          makeCommunication({ category: 'General' }),
        );

        await service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y' },
          user('B', 'admin-1'),
        );
        await settle();

        expect(prisma.propertyMembership.findMany).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('dirigido a una propiedad concreta, solo avisa a SUS miembros (no a toda la finca)', async () => {
        prisma.communication.create.mockResolvedValue(
          makeCommunication({ category: 'Urgente', targetPropertyId: 'p1' }),
        );
        prisma.property.findFirst.mockResolvedValue({
          id: 'p1',
          estateId: ESTATE,
        });
        prisma.propertyMembership.findMany.mockResolvedValue([
          { userId: 'vecino-1' },
        ]);

        await service.createCommunication(
          ESTATE,
          {
            title: 'x',
            body: 'y',
            category: 'Urgente',
            targetPropertyId: 'p1',
          },
          user('B', 'admin-1'),
        );
        await settle();

        expect(prisma.propertyMembership.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ property: { id: 'p1' } }),
          }),
        );
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({ propertyId: 'p1' }),
        );
      });

      it('sin ningún miembro elegible no llama a NotificationsService.notify en vano', async () => {
        prisma.communication.create.mockResolvedValue(
          makeCommunication({ category: 'Urgente' }),
        );
        prisma.propertyMembership.findMany.mockResolvedValue([]);

        await service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', category: 'Urgente' },
          user('B', 'admin-1'),
        );
        await settle();

        expect(notifications.notify).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateCommunication', () => {
    it('B editando un comunicado ajeno deja traza: lastEditedBy* + ActivityLogEntry', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        title: 'Editado',
      });

      await service.updateCommunication(
        'comm-1',
        { title: 'Editado' },
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communication.update.mock.calls[0];
      expect(data.lastEditedByUserId).toBe('admin-1');
      expect(data.lastEditedAt).toBeInstanceOf(Date);
      expect(prisma.activityLogEntry.create).toHaveBeenCalledTimes(1);
      const [{ data: logData }] = prisma.activityLogEntry.create.mock.calls[0];
      expect(logData.verb).toBe('updated');
      expect(logData.subjectType).toBe('communication');
      expect(logData.actorUserId).toBe('admin-1');
    });

    it('B editando lo propio NO deja traza de "admin editó"', async () => {
      const existing = makeCommunication({ authorUserId: 'admin-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        title: 'Editado',
      });

      await service.updateCommunication(
        'comm-1',
        { title: 'Editado' },
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communication.update.mock.calls[0];
      expect(data.lastEditedByUserId).toBeUndefined();
      expect(prisma.activityLogEntry.create).not.toHaveBeenCalled();
    });

    it('C edita lo propio sin problema y sin traza', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        title: 'Editado',
      });

      await expect(
        service.updateCommunication(
          'comm-1',
          { title: 'Editado' },
          user('C', 'vecino-1'),
        ),
      ).resolves.toBeDefined();
      expect(prisma.activityLogEntry.create).not.toHaveBeenCalled();
    });

    it('C NO puede editar el comunicado de otro vecino', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);

      await expect(
        service.updateCommunication(
          'comm-1',
          { title: 'Hackeado' },
          user('C', 'vecino-2'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.communication.update).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el comunicado ya está borrado (borrado blando)', async () => {
      prisma.communication.findFirst.mockResolvedValue(null);
      await expect(
        service.updateCommunication(
          'comm-1',
          { title: 'x' },
          user('B', 'admin-1'),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCommunication', () => {
    it('es un borrado blando (setea deletedAt), nunca un DELETE físico', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        deletedAt: new Date(),
      });

      await service.deleteCommunication('comm-1', user('C', 'vecino-1'));

      const [{ data }] = prisma.communication.update.mock.calls[0];
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('B eliminando lo de otro vecino deja traza en ActivityLogEntry', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        deletedAt: new Date(),
      });

      await service.deleteCommunication('comm-1', user('B', 'admin-1'));

      expect(prisma.activityLogEntry.create).toHaveBeenCalledTimes(1);
      const [{ data }] = prisma.activityLogEntry.create.mock.calls[0];
      expect(data.verb).toBe('deleted');
    });

    it('C NO puede eliminar el comunicado de otro vecino', async () => {
      const existing = makeCommunication({ authorUserId: 'vecino-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);

      await expect(
        service.deleteCommunication('comm-1', user('C', 'vecino-2')),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setCommunicationArchived', () => {
    it('archiva y deja traza, SIN excepción de propiedad (incluso sobre lo propio)', async () => {
      const existing = makeCommunication({ authorUserId: 'admin-1' });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        archivedByAdmin: true,
      });

      await service.setCommunicationArchived(
        'comm-1',
        true,
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communication.update.mock.calls[0];
      expect(data.archivedByAdmin).toBe(true);
      const [{ data: logData }] = prisma.activityLogEntry.create.mock.calls[0];
      expect(logData.verb).toBe('archived');
    });

    it('desarchiva — el toggle es bidireccional', async () => {
      const existing = makeCommunication({ archivedByAdmin: true });
      prisma.communication.findFirst.mockResolvedValue(existing);
      prisma.communication.update.mockResolvedValue({
        ...existing,
        archivedByAdmin: false,
      });

      await service.setCommunicationArchived(
        'comm-1',
        false,
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communication.update.mock.calls[0];
      expect(data.archivedByAdmin).toBe(false);
    });
  });

  describe('visibilidad calculada — sin CRON ni columna propia para el vencimiento por fecha', () => {
    it('un comunicado vencido por fecha pero con archivedByAdmin=false se expone igual como archived:true', async () => {
      const vencido = makeCommunication({
        activeUntil: new Date(Date.now() - 1000),
        archivedByAdmin: false,
      });
      prisma.communication.findMany.mockResolvedValue([vencido]);

      const page = await service.listCommunications(
        ESTATE,
        user('B', 'admin-1'),
        {},
      );

      expect(page.items[0].archived).toBe(true);
    });

    it('un comunicado vigente (sin activeUntil) se expone como archived:false', async () => {
      prisma.communication.findMany.mockResolvedValue([makeCommunication()]);

      const page = await service.listCommunications(
        ESTATE,
        user('B', 'admin-1'),
        {},
      );

      expect(page.items[0].archived).toBe(false);
    });

    it('rol C, filtro por defecto ("active"): oculta lo archivado/vencido de CUALQUIERA, autor incluido', async () => {
      await service.listCommunications(ESTATE, user('C', 'vecino-2'), {});

      const [{ where }] = prisma.communication.findMany.mock.calls[0];
      expect(where.archivedByAdmin).toBe(false);
      expect(where.authorUserId).toBeUndefined();
    });

    it('rol C, filtro "archived": solo ve lo archivado/vencido que publicó él mismo', async () => {
      await service.listCommunications(ESTATE, user('C', 'vecino-2'), {
        filter: 'archived',
      });

      const [{ where }] = prisma.communication.findMany.mock.calls[0];
      expect(where.authorUserId).toBe('vecino-2');
      expect(where.OR).toEqual([
        { archivedByAdmin: true },
        { activeUntil: { lte: expect.any(Date) } },
      ]);
    });

    it('rol B con filter="all" ve todo, sin restricción de archivado ni de autor', async () => {
      await service.listCommunications(ESTATE, user('B', 'admin-1'), {
        filter: 'all',
      });

      const [{ where }] = prisma.communication.findMany.mock.calls[0];
      expect(where.archivedByAdmin).toBeUndefined();
      expect(where.authorUserId).toBeUndefined();
    });

    it('rol B con filter="archived" ve lo archivado/vencido de cualquier autor', async () => {
      await service.listCommunications(ESTATE, user('B', 'admin-1'), {
        filter: 'archived',
      });

      const [{ where }] = prisma.communication.findMany.mock.calls[0];
      expect(where.authorUserId).toBeUndefined();
      expect(where.OR).toEqual([
        { archivedByAdmin: true },
        { activeUntil: { lte: expect.any(Date) } },
      ]);
    });
  });

  describe('assertPrivilegedFields — categoría/destino/notificación legal solo A/B', () => {
    it('rol C no puede publicar category: Urgente', async () => {
      await expect(
        service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', category: 'Urgente' } as any,
          user('C', 'vecino-1'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });

    it('rol C no puede dirigir un comunicado a una propiedad', async () => {
      await expect(
        service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', targetPropertyId: 'prop-1' } as any,
          user('C', 'vecino-1'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });

    it('rol C no puede marcarlo como notificación fehaciente', async () => {
      await expect(
        service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', isLegalNotice: true } as any,
          user('C', 'vecino-1'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });

    it('rol B sí puede publicar Urgente, dirigido y como notificación legal', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1' });
      prisma.communication.create.mockResolvedValue(
        makeCommunication({
          category: 'Urgente',
          targetPropertyId: 'prop-1',
          isLegalNotice: true,
        }),
      );

      await expect(
        service.createCommunication(
          ESTATE,
          {
            title: 'x',
            body: 'y',
            category: 'Urgente',
            targetPropertyId: 'prop-1',
            isLegalNotice: true,
            legalNoticeSignerRole: 'secretario',
            legalNoticeReason: 'Domicilio desconocido',
          } as any,
          user('B', 'admin-1'),
        ),
      ).resolves.toMatchObject({ category: 'Urgente', isLegalNotice: true });
    });

    it('rechaza targetPropertyId de una propiedad que no es de esa finca', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommunication(
          ESTATE,
          { title: 'x', body: 'y', targetPropertyId: 'prop-ajena' } as any,
          user('B', 'admin-1'),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });
  });

  describe('respuestas — cualquier rol con acceso, autor inferido server-side', () => {
    it('rol C responde a un comunicado ajeno, con role Propietario', async () => {
      prisma.communication.findFirst.mockResolvedValue(
        makeCommunication({ authorUserId: 'admin-1' }),
      );
      prisma.communicationReply.create.mockResolvedValue({
        id: 'reply-1',
        communicationId: 'comm-1',
        authorUserId: 'vecino-1',
        role: 'Propietario',
        text: 'Gracias por avisar',
        createdAt: new Date(),
        authorUser: { fullName: 'Vecino Uno' },
      });

      const reply = await service.addCommunicationReply(
        'comm-1',
        { text: 'Gracias por avisar' },
        user('C', 'vecino-1'),
      );

      expect(reply.role).toBe('Propietario');
      const [{ data }] = prisma.communicationReply.create.mock.calls[0];
      expect(data.role).toBe('Propietario');
      expect(data.authorUserId).toBe('vecino-1');
    });

    it('rol B responde con role Administrador', async () => {
      prisma.communication.findFirst.mockResolvedValue(
        makeCommunication({ authorUserId: 'vecino-1' }),
      );
      prisma.communicationReply.create.mockResolvedValue({
        id: 'reply-1',
        communicationId: 'comm-1',
        authorUserId: 'admin-1',
        role: 'Administrador',
        text: 'Tomamos nota',
        createdAt: new Date(),
        authorUser: { fullName: 'Gestora Admin' },
      });

      await service.addCommunicationReply(
        'comm-1',
        { text: 'Tomamos nota' },
        user('B', 'admin-1'),
      );

      const [{ data }] = prisma.communicationReply.create.mock.calls[0];
      expect(data.role).toBe('Administrador');
    });

    it('C no puede responder a un comunicado dirigido a una propiedad ajena', async () => {
      prisma.communication.findFirst.mockResolvedValue(
        makeCommunication({
          authorUserId: 'admin-1',
          targetPropertyId: 'prop-ajena',
        }),
      );
      prisma.propertyMembership.findMany.mockResolvedValue([
        { propertyId: 'prop-propia' },
      ]);

      await expect(
        service.addCommunicationReply(
          'comm-1',
          { text: 'x' },
          user('C', 'vecino-1'),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.communicationReply.create).not.toHaveBeenCalled();
    });

    it('C borra su propia respuesta', async () => {
      prisma.communication.findFirst.mockResolvedValue(makeCommunication());
      prisma.communicationReply.findFirst.mockResolvedValue({
        id: 'reply-1',
        communicationId: 'comm-1',
        authorUserId: 'vecino-1',
        deletedAt: null,
      });

      await service.deleteCommunicationReply(
        'comm-1',
        'reply-1',
        user('C', 'vecino-1'),
      );

      expect(prisma.communicationReply.update).toHaveBeenCalledWith({
        where: { id: 'reply-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('C NO puede borrar la respuesta de otro vecino', async () => {
      prisma.communication.findFirst.mockResolvedValue(makeCommunication());
      prisma.communicationReply.findFirst.mockResolvedValue({
        id: 'reply-1',
        communicationId: 'comm-1',
        authorUserId: 'vecino-2',
        deletedAt: null,
      });

      await expect(
        service.deleteCommunicationReply(
          'comm-1',
          'reply-1',
          user('C', 'vecino-1'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.communicationReply.update).not.toHaveBeenCalled();
    });

    it('B (moderación) puede borrar la respuesta de cualquier vecino', async () => {
      prisma.communication.findFirst.mockResolvedValue(makeCommunication());
      prisma.communicationReply.findFirst.mockResolvedValue({
        id: 'reply-1',
        communicationId: 'comm-1',
        authorUserId: 'vecino-1',
        deletedAt: null,
      });

      await service.deleteCommunicationReply(
        'comm-1',
        'reply-1',
        user('B', 'admin-1'),
      );

      expect(prisma.communicationReply.update).toHaveBeenCalled();
    });
  });
});

describe('ResourcesService — alertas de juntas', () => {
  /**
   * `listAlerts` toca ~10 modelos distintos; aquí solo interesa qué se le
   * pide a `meeting.findMany`, así que el resto de modelos devuelven vacío.
   */
  function serviceWithEmptyPrisma(
    meetingFindMany: jest.Mock,
  ): ResourcesService {
    const emptyModel = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    };
    const models: Record<string, unknown> = {
      meeting: { findMany: meetingFindMany },
    };
    const prisma = new Proxy(models, {
      get: (target, key: string) => (key in target ? target[key] : emptyModel),
    });
    return new ResourcesService(
      prisma as unknown as PrismaService,
      new EstateAccessService(),
      { get: () => 'http://localhost:4200' } as any,
      {} as any,
      {} as any,
      new RagAuthorizationService(prisma as unknown as PrismaService),
    );
  }

  // Sin el filtro, una junta cancelada seguiría avisando como "convocada"
  // (antes daba igual: nada cambiaba `Meeting.status`).
  it.each([
    ['gestora (rol B)', 'B'],
    ['propietario (rol C)', 'C'],
  ] as const)(
    'alertas de %s: solo trae juntas convocadas, futuras y con videollamada',
    async (_label, role) => {
      const meetingFindMany = jest.fn().mockResolvedValue([]);
      const service = serviceWithEmptyPrisma(meetingFindMany);

      await service.listAlerts(user(role, 'u-1'));

      expect(meetingFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          estateId: { in: [ESTATE] },
          includeJitsi: true,
          status: 'convocada',
          scheduledAt1: { gte: expect.any(Date) },
        }),
      });
    },
  );

  it('limits the recent dropdown after preserving alert ordering', async () => {
    const meetings = Array.from({ length: 8 }, (_, index) => ({
      id: `m-${index}`,
      title: `Junta ${index}`,
      location: null,
      scheduledAt1: new Date(Date.UTC(2026, 10, index + 1)),
      estateId: ESTATE,
    }));
    const service = serviceWithEmptyPrisma(
      jest.fn().mockResolvedValue(meetings),
    );

    const alerts = await service.listAlerts(user('B', 'u-1'), 6);

    expect(alerts).toHaveLength(6);
    expect(alerts.map((alert) => alert.sourceId)).toEqual([
      'm-7',
      'm-6',
      'm-5',
      'm-4',
      'm-3',
      'm-2',
    ]);
  });
});
