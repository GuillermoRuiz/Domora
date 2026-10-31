import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DirectMessageAttachmentsService,
  type DirectMessageUpload,
} from './direct-message-attachments.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { DirectMessagesService } from './direct-messages.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const USER: AuthenticatedUser = {
  id: 'me',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'admin',
};
const FILE: DirectMessageUpload = {
  originalname: 'acta.pdf',
  mimetype: 'application/pdf',
  size: 3,
  buffer: Buffer.from('pdf'),
};

function setup() {
  const prisma = {
    directMessage: {
      create: jest.fn().mockResolvedValue({
        id: 'm1',
        attachments: [
          {
            id: 'a1',
            name: FILE.originalname,
            mimeType: FILE.mimetype,
            sizeBytes: 3,
          },
        ],
      }),
    },
    directMessageAttachment: {
      findUnique: jest.fn().mockResolvedValue({
        s3Key: 'private/key',
        name: FILE.originalname,
        message: { conversationId: 'c1' },
      }),
    },
  };
  const storage = {
    assertAllowed: jest.fn(),
    put: jest.fn().mockResolvedValue('private/key'),
    delete: jest.fn(),
    get: jest.fn().mockResolvedValue(FILE.buffer),
  };
  const messages = {
    ensureConversationAccess: jest.fn().mockResolvedValue('c1'),
    assertParticipant: jest.fn(),
    notifyRecipient: jest.fn(),
    revealConversation: jest.fn(),
    logSent: jest.fn(),
  };
  const service = new DirectMessageAttachmentsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    messages as unknown as DirectMessagesService,
  );
  return { prisma, storage, messages, service };
}

describe('Adjuntos de mensajes', () => {
  it('guarda archivos y mensaje juntos y devuelve metadatos sin claves de almacenamiento', async () => {
    const { service, prisma, messages } = setup();
    const message = await service.send(
      { conversationId: 'c1', text: ' Acta ' },
      [FILE],
      USER,
    );
    expect(messages.logSent).toHaveBeenCalledWith('c1', 'm1', USER);
    expect(message).toMatchObject({
      id: 'm1',
      attachments: [{ id: 'a1', name: 'acta.pdf' }],
    });
    expect(JSON.stringify(message)).not.toContain('private/key');
    expect(prisma.directMessage.create.mock.calls[0][0].data.text).toBe('Acta');
  });

  it('rechaza a un usuario ajeno antes de escribir ningún archivo', async () => {
    const { service, messages, storage } = setup();
    messages.ensureConversationAccess.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.send({ conversationId: 'foreign' }, [FILE], USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rechaza archivos no admitidos o más de cinco adjuntos antes de guardar', async () => {
    const { service, storage } = setup();
    storage.assertAllowed.mockImplementation(() => {
      throw new BadRequestException();
    });
    await expect(service.send({}, [FILE], USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.send({}, Array(6).fill(FILE), USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('limpia los archivos guardados si falla la persistencia del mensaje', async () => {
    const { service, storage, prisma } = setup();
    prisma.directMessage.create.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      service.send({ conversationId: 'c1' }, [FILE], USER),
    ).rejects.toThrow('database unavailable');
    expect(storage.delete).toHaveBeenCalledWith('private/key');
  });

  it('solo permite descargar a participantes, aunque conozcan el id del adjunto', async () => {
    const { service, messages, storage } = setup();
    messages.assertParticipant.mockRejectedValue(new ForbiddenException());
    await expect(service.download('a1', USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('un fallo de aviso no borra un mensaje ya guardado ni sus archivos', async () => {
    const { service, messages, storage } = setup();
    messages.notifyRecipient.mockRejectedValue(
      new Error('notification unavailable'),
    );
    await expect(
      service.send({ conversationId: 'c1' }, [FILE], USER),
    ).resolves.toMatchObject({ id: 'm1' });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
