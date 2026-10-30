/* eslint-disable @typescript-eslint/no-explicit-any */
import { DirectMessagesService } from './direct-messages.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const SENDER: AuthenticatedUser = {
  id: 'sender-1',
  role: 'C',
  estateIds: ['e1'],
  administratorId: null,
};

describe('DirectMessagesService — avisos al enviar un mensaje', () => {
  let prisma: any;
  let notifications: any;
  let service: DirectMessagesService;

  beforeEach(() => {
    prisma = {
      directMessageParticipant: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue({ userId: 'recipient-1' }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ conversationId: 'c1', userId: 'sender-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      directMessage: {
        create: jest.fn().mockResolvedValue({ id: 'm1', text: 'hola' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Ana García' }),
      },
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new DirectMessagesService(prisma, notifications);
  });

  it('avisa al OTRO participante (no al propio remitente) de la conversación', async () => {
    await service.sendMessage(
      { conversationId: 'c1', text: 'hola' } as any,
      SENDER,
    );

    expect(prisma.directMessageParticipant.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c1', userId: { not: 'sender-1' } },
      select: { userId: true },
    });
    expect(notifications.notify).toHaveBeenCalledWith({
      userIds: ['recipient-1'],
      category: 'direct_message',
      title: 'Nuevo mensaje de Ana García',
      link: { B: '/b/messages', C: '/c/messages' },
      dedupeKey: 'dm:c1',
    });
  });

  it('el enlace es distinto por rol: cada quien va a la bandeja de mensajes de su propio panel', async () => {
    await service.sendMessage(
      { conversationId: 'c1', text: 'hola' } as any,
      SENDER,
    );

    const link = notifications.notify.mock.calls[0][0].link;
    expect(link).toEqual({ B: '/b/messages', C: '/c/messages' });
  });

  it('la clave de colapso es por conversación, no por mensaje: una ráfaga solo genera un aviso', async () => {
    await service.sendMessage(
      { conversationId: 'c1', text: 'uno' } as any,
      SENDER,
    );
    await service.sendMessage(
      { conversationId: 'c1', text: 'dos' } as any,
      SENDER,
    );

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    const keys = notifications.notify.mock.calls.map(
      (c: any) => c[0].dedupeKey,
    );
    expect(keys).toEqual(['dm:c1', 'dm:c1']);
  });

  it('sin ningún otro participante (conversación mal formada) no avisa a nadie', async () => {
    prisma.directMessageParticipant.findFirst.mockResolvedValue(null);

    await service.sendMessage(
      { conversationId: 'c1', text: 'hola' } as any,
      SENDER,
    );

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('sin el nombre del remitente (usuario borrado a medias) usa un texto genérico en vez de romper', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.sendMessage(
      { conversationId: 'c1', text: 'hola' } as any,
      SENDER,
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nuevo mensaje de un usuario' }),
    );
  });

  it('devuelve el mensaje creado', async () => {
    await expect(
      service.sendMessage(
        { conversationId: 'c1', text: 'hola' } as any,
        SENDER,
      ),
    ).resolves.toEqual({
      id: 'm1',
      text: 'hola',
    });
  });
});
