import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DirectMessageEditsService } from './direct-message-edits.service';
import {
  DirectMessagesService,
  DELETED_MESSAGE_PREVIEW,
} from './direct-messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const ME: AuthenticatedUser = {
  id: 'me',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'admin',
};

function setupEdits(message: Record<string, unknown> | null) {
  const prisma = {
    directMessage: {
      findUnique: jest.fn().mockResolvedValue(message),
      update: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'm1',
            ...data,
            attachments: [],
          }),
        ),
    },
    directMessageAttachment: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const messages = {
    assertParticipant: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DirectMessageEditsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    messages as unknown as DirectMessagesService,
  );
  return { service, prisma, storage, messages };
}

const OWN = {
  id: 'm1',
  conversationId: 'c1',
  senderId: 'me',
  text: 'Hola',
  deletedAt: null,
  attachments: [],
};

describe('Edición de mensajes', () => {
  it('guarda el nuevo texto recortado y marca la fecha de edición', async () => {
    const { service, prisma } = setupEdits(OWN);
    await service.edit('m1', '  Hola de nuevo ', ME);
    const data = prisma.directMessage.update.mock.calls[0][0].data;
    expect(data.text).toBe('Hola de nuevo');
    expect(data.editedAt).toBeInstanceOf(Date);
  });

  it('si el texto no cambia no marca el mensaje como editado', async () => {
    const { service, prisma } = setupEdits(OWN);
    await service.edit('m1', ' Hola ', ME);
    expect(prisma.directMessage.update).not.toHaveBeenCalled();
  });

  it('no deja un mensaje sin texto ni adjuntos, pero sí uno con adjuntos', async () => {
    await expect(
      setupEdits(OWN).service.edit('m1', '   ', ME),
    ).rejects.toBeInstanceOf(BadRequestException);
    const withFile = {
      ...OWN,
      attachments: [
        {
          id: 'a1',
          name: 'acta.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          s3Key: 'k',
        },
      ],
    };
    const { service, prisma } = setupEdits(withFile);
    await service.edit('m1', '', ME);
    expect(prisma.directMessage.update).toHaveBeenCalled();
  });

  it('solo el autor puede editar y un mensaje borrado ya no se edita', async () => {
    await expect(
      setupEdits({ ...OWN, senderId: 'other' }).service.edit('m1', 'x', ME),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setupEdits({ ...OWN, deletedAt: new Date() }).service.edit('m1', 'x', ME),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un mensaje inexistente da 404 y uno de una conversación ajena se rechaza', async () => {
    await expect(
      setupEdits(null).service.edit('m1', 'x', ME),
    ).rejects.toBeInstanceOf(NotFoundException);
    const { service, messages, prisma } = setupEdits(OWN);
    messages.assertParticipant.mockRejectedValue(new ForbiddenException());
    await expect(service.edit('m1', 'x', ME)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.directMessage.update).not.toHaveBeenCalled();
  });
});

describe('Borrado de mensajes', () => {
  it('vacía el texto, marca el borrado y elimina adjuntos de la base de datos y del almacenamiento', async () => {
    const withFile = {
      ...OWN,
      attachments: [
        {
          id: 'a1',
          name: 'acta.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          s3Key: 'private/key',
        },
      ],
    };
    const { service, prisma, storage } = setupEdits(withFile);
    await service.remove('m1', ME);
    expect(prisma.directMessage.update.mock.calls[0][0].data).toMatchObject({
      text: '',
      deletedAt: expect.any(Date),
    });
    expect(prisma.directMessageAttachment.deleteMany).toHaveBeenCalledWith({
      where: { messageId: 'm1' },
    });
    expect(storage.delete).toHaveBeenCalledWith('private/key');
  });

  it('es idempotente y no toca nada si ya estaba borrado', async () => {
    const { service, prisma } = setupEdits({
      ...OWN,
      deletedAt: new Date('2026-10-18'),
    });
    await service.remove('m1', ME);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un fallo al borrar un archivo no deshace el borrado del mensaje', async () => {
    const withFile = {
      ...OWN,
      attachments: [
        {
          id: 'a1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          s3Key: 'k',
        },
      ],
    };
    const { service, storage } = setupEdits(withFile);
    storage.delete.mockRejectedValue(new Error('disk'));
    await expect(service.remove('m1', ME)).resolves.toMatchObject({ id: 'm1' });
  });

  it('solo el autor puede borrar', async () => {
    await expect(
      setupEdits({ ...OWN, senderId: 'other' }).service.remove('m1', ME),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DirectMessagesService: lectura y borrados', () => {
  function setupList() {
    const read = new Date('2026-10-18T10:00:00Z');
    const messages = [
      {
        id: 'm3',
        senderId: 'neighbor',
        text: 'Gracias',
        createdAt: new Date('2026-10-18T09:50:00Z'),
        attachments: [],
      },
      {
        id: 'm2',
        senderId: 'me',
        text: 'Mañana',
        createdAt: new Date('2026-10-18T10:05:00Z'),
        attachments: [],
      },
      {
        id: 'm1',
        senderId: 'me',
        text: 'Hola',
        createdAt: new Date('2026-10-18T09:00:00Z'),
        attachments: [],
      },
    ];
    const prisma = {
      directMessageParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p' }),
        findFirst: jest.fn().mockResolvedValue({ lastReadAt: read }),
      },
      directMessage: { findMany: jest.fn().mockResolvedValue(messages) },
    };
    return {
      prisma,
      service: new DirectMessagesService(
        prisma as unknown as PrismaService,
        {} as NotificationsService,
      ),
    };
  }

  it('marca como leídos solo los mensajes propios anteriores a la última lectura del otro', async () => {
    const result = await setupList().service.listMessages('c1', ME);
    expect(result.map((m) => [m.id, m.readByRecipient])).toEqual([
      ['m1', true],
      ['m2', false],
      ['m3', false],
    ]);
  });

  it('la bandeja avisa cuando el último mensaje está borrado, sin contarlo como no leído', async () => {
    const prisma = {
      directMessageParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            conversationId: 'c1',
            lastReadAt: null,
            conversation: {
              createdAt: new Date('2026-10-16'),
              participants: [{ userId: 'me' }, { userId: 'n1' }],
              messages: [
                {
                  text: '',
                  senderId: 'n1',
                  createdAt: new Date('2026-10-17'),
                  deletedAt: new Date('2026-10-17'),
                  attachments: [],
                },
              ],
            },
          },
        ]),
      },
      directMessage: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ fullName: 'Vecino', role: 'C' }),
      },
      propertyMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ property: { estateId: 'e1' } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userMessagingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new DirectMessagesService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );
    const [row] = await service.listConversations(ME);
    expect(row).toMatchObject({ lastMessagePreview: DELETED_MESSAGE_PREVIEW });
    expect(prisma.directMessage.count.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
    });
  });
});
