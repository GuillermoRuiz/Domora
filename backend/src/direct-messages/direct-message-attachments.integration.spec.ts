import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { DirectMessageAttachmentsService } from './direct-message-attachments.service';
import { DirectMessagesService } from './direct-messages.service';
import { StorageService } from '../files/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

if (!process.env.DATABASE_URL && existsSync('.env')) loadEnvFile('.env');
const prisma = createPrismaClient();
const users: string[] = [];
let conversationId = '';
let storageRoot = '';
let service: DirectMessageAttachmentsService;
let messages: DirectMessagesService;
let participant: AuthenticatedUser;

beforeAll(async () => {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('Attachment integration tests require a local database.');
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'domora-message-attachments-test-'));
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { email: `messages-qa-${randomUUID()}@example.invalid`, fullName: 'Attachment Test', passwordHash: 'not-a-login-password', role: 'C' } });
    users.push(user.id);
  }
  const conversation = await prisma.conversation.create({ data: { participants: { create: users.map(userId => ({ userId })) } } });
  conversationId = conversation.id;
  participant = { id: users[0], role: 'C', estateIds: [], administratorId: null };
  messages = new DirectMessagesService(prisma as unknown as PrismaService, { notify: async () => {} } as unknown as NotificationsService);
  const storage = new StorageService({ get: () => storageRoot } as unknown as ConfigService);
  service = new DirectMessageAttachmentsService(prisma as unknown as PrismaService, storage, messages);
});

afterAll(async () => {
  try {
    if (conversationId) await prisma.conversation.deleteMany({ where: { id: conversationId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await prisma.$disconnect();
    if (storageRoot) {
      if (!path.resolve(storageRoot).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(storageRoot).startsWith('domora-message-attachments-test-')) throw new Error('Unsafe attachment test cleanup path');
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  }
});

it('persiste un adjunto real, lo recupera con el hilo y solo permite descargarlo a sus participantes', async () => {
  const bytes = Buffer.from('%PDF-1.4\nArchivo de prueba\n%%EOF');
  const sent = await service.send({ conversationId, text: 'Documento de prueba' }, [{ originalname: 'acta.pdf', mimetype: 'application/pdf', buffer: bytes, size: bytes.length }], participant);
  expect(sent.attachments).toHaveLength(1);
  const history = await messages.listMessages(conversationId, participant);
  expect(history[0].attachments[0].name).toBe('acta.pdf');
  expect(JSON.stringify(history)).not.toContain('s3Key');
  const downloaded = await service.download(sent.attachments[0].id, { ...participant, id: users[1] });
  expect(downloaded.content.equals(bytes)).toBe(true);
  await expect(service.download(sent.attachments[0].id, { ...participant, id: randomUUID() })).rejects.toBeInstanceOf(ForbiddenException);
});
