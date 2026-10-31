import { ForbiddenException } from '@nestjs/common';
import { DirectMessagesService } from './direct-messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const USER: AuthenticatedUser = {
  id: 'me',
  role: 'B',
  estateIds: ['e1', 'e2'],
  administratorId: 'admin',
};

function setup() {
  const rows = ['e1', 'e2'].map((estateId, index) => ({
    conversationId: `c${index + 1}`,
    lastReadAt: null,
    conversation: {
      createdAt: new Date('2026-10-16'),
      participants: [{ userId: 'me' }, { userId: `neighbor-${estateId}` }],
      messages: [
        {
          text: `Hola ${estateId}`,
          senderId: `neighbor-${estateId}`,
          createdAt: new Date('2026-10-17'),
        },
      ],
    },
  }));
  const prisma = {
    directMessageParticipant: { findMany: jest.fn().mockResolvedValue(rows) },
    directMessage: { count: jest.fn().mockResolvedValue(1) },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ fullName: 'Vecino', role: 'C' }),
    },
    propertyMembership: {
      findFirst: jest
        .fn()
        .mockImplementation(
          async ({
            where,
          }: {
            where: { userId: string; property: { estateId: { in: string[] } } };
          }) => {
            const estateId = where.userId.replace('neighbor-', '');
            return where.property.estateId.in.includes(estateId)
              ? { property: { estateId } }
              : null;
          },
        ),
      findMany: jest
        .fn()
        .mockImplementation(
          async ({
            where,
          }: {
            where: { property: { estateId: string | { in: string[] } } };
          }) =>
            typeof where.property.estateId === 'string'
              ? []
              : where.property.estateId.in.map((estateId) => ({
                  userId: `neighbor-${estateId}`,
                  property: { estateId },
                })),
        ),
    },
    userMessagingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new DirectMessagesService(
    prisma as unknown as PrismaService,
    {} as NotificationsService,
  );
  return { service, prisma };
}

describe('DirectMessagesService: ámbito de comunidad', () => {
  it('sin filtro conserva todas las conversaciones del participante', async () => {
    const { service } = setup();
    expect(
      (await service.listConversations(USER)).map((row) => row.id).sort(),
    ).toEqual(['c1', 'c2']);
  });

  it('solo devuelve conversaciones compartidas en la comunidad seleccionada', async () => {
    const { service } = setup();
    const result = await service.listConversations(USER, 'e2');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'c2',
      estateId: 'e2',
      lastMessageSenderId: 'neighbor-e2',
    });
  });

  it('limita también los destinatarios a la comunidad seleccionada', async () => {
    const { service } = setup();
    expect(await service.listContacts(USER, 'e2')).toEqual([
      {
        userId: 'neighbor-e2',
        displayName: 'Vecino',
        estateId: 'e2',
        conversationId: null,
      },
    ]);
  });

  it('rechaza ámbitos ajenos antes de consultar conversaciones o contactos', async () => {
    const { service, prisma } = setup();
    await expect(
      service.listConversations(USER, 'foreign'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listContacts(USER, 'foreign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.directMessageParticipant.findMany).not.toHaveBeenCalled();
    expect(prisma.propertyMembership.findMany).not.toHaveBeenCalled();
  });
});
