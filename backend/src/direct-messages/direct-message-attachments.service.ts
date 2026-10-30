import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { DirectMessagesService } from './direct-messages.service';
import { DIRECT_MESSAGE_ATTACHMENT_SELECT } from './direct-message-attachment.fields';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Prisma } from '../prisma/client';

export interface DirectMessageUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
export interface AttachmentMessageInput {
  conversationId?: string;
  recipientUserId?: string;
  text?: string;
}

@Injectable()
export class DirectMessageAttachmentsService {
  private readonly logger = new Logger(DirectMessageAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly messages: DirectMessagesService,
  ) {}

  async send(input: AttachmentMessageInput, files: DirectMessageUpload[], user: AuthenticatedUser) {
    if (!files?.length || files.length > 5) throw new BadRequestException('Adjunta entre 1 y 5 archivos.');
    for (const file of files) {
      this.storage.assertAllowed(file.mimetype, file.buffer.length);
      if (!file.buffer.length) throw new BadRequestException('No se pueden adjuntar archivos vacíos.');
    }
    const conversationId = await this.messages.ensureConversationAccess(input, user);
    const stored: { name: string; mimeType: string; sizeBytes: number; s3Key: string }[] = [];
    let message: Prisma.DirectMessageGetPayload<{ include: { attachments: { select: typeof DIRECT_MESSAGE_ATTACHMENT_SELECT } } }>;
    try {
      for (const file of files) {
        const name = file.originalname.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'archivo';
        const s3Key = await this.storage.put(`direct-messages/${conversationId}`, name, file.buffer);
        stored.push({ name, mimeType: file.mimetype, sizeBytes: file.buffer.length, s3Key });
      }
      message = await this.prisma.directMessage.create({
        data: { conversationId, senderId: user.id, text: input.text?.trim() ?? '', attachments: { create: stored } },
        include: { attachments: { select: DIRECT_MESSAGE_ATTACHMENT_SELECT } },
      });
    } catch (error) {
      const cleanup = await Promise.allSettled(stored.map(file => this.storage.delete(file.s3Key)));
      if (cleanup.some(result => result.status === 'rejected')) this.logger.error('No se pudieron limpiar todos los adjuntos temporales.');
      throw error;
    }
    await this.messages.revealConversation(conversationId);
    // Notification failure must not undo a message already committed with its files.
    try { await this.messages.notifyRecipient(conversationId, user); }
    catch { this.logger.warn('El mensaje se guardó, pero no se pudo emitir su aviso.'); }
    await this.messages.logSent(conversationId, message.id, user);
    return message;
  }

  async download(id: string, user: AuthenticatedUser) {
    const attachment = await this.prisma.directMessageAttachment.findUnique({
      where: { id }, include: { message: { select: { conversationId: true } } },
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');
    await this.messages.assertParticipant(attachment.message.conversationId, user.id);
    return { content: await this.storage.get(attachment.s3Key), name: attachment.name };
  }
}
