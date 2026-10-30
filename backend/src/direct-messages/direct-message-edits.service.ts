import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { DIRECT_MESSAGE_ATTACHMENT_SELECT } from './direct-message-attachment.fields';
import { DirectMessagesService } from './direct-messages.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Edición y borrado de mensajes: solo su autor, y el borrado es lógico para que el hilo conserve su orden. */
@Injectable()
export class DirectMessageEditsService {
  private readonly logger = new Logger(DirectMessageEditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly messages: DirectMessagesService,
  ) {}

  /** Mensaje del usuario dentro de una conversación en la que participa; cualquier otro caso se rechaza. */
  private async findOwn(id: string, user: AuthenticatedUser) {
    const message = await this.prisma.directMessage.findUnique({
      where: { id },
      include: { attachments: { select: { ...DIRECT_MESSAGE_ATTACHMENT_SELECT, s3Key: true } } },
    });
    if (!message) throw new NotFoundException('Mensaje no encontrado.');
    await this.messages.assertParticipant(message.conversationId, user.id);
    if (message.senderId !== user.id) throw new ForbiddenException('Solo puedes modificar tus propios mensajes.');
    return message;
  }

  async edit(id: string, text: string, user: AuthenticatedUser) {
    const message = await this.findOwn(id, user);
    if (message.deletedAt) throw new BadRequestException('Este mensaje ya se ha borrado.');
    const next = text.trim();
    if (!next && message.attachments.length === 0) throw new BadRequestException('El mensaje no puede quedar vacío.');
    const publicAttachments = message.attachments.map(({ id: attachmentId, name, mimeType, sizeBytes }) => ({ id: attachmentId, name, mimeType, sizeBytes }));
    // Sin cambios reales no se marca como editado.
    if (next === message.text) return { ...message, attachments: publicAttachments };
    const updated = await this.prisma.directMessage.update({
      where: { id },
      data: { text: next, editedAt: new Date() },
      include: { attachments: { select: DIRECT_MESSAGE_ATTACHMENT_SELECT } },
    });
    return updated;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const message = await this.findOwn(id, user);
    if (message.deletedAt) return { id, deletedAt: message.deletedAt };
    const [updated] = await this.prisma.$transaction([
      this.prisma.directMessage.update({ where: { id }, data: { text: '', deletedAt: new Date() }, select: { id: true, deletedAt: true } }),
      this.prisma.directMessageAttachment.deleteMany({ where: { messageId: id } }),
    ]);
    // Los archivos privados salen del almacenamiento una vez confirmado el borrado en base de datos.
    const cleanup = await Promise.allSettled(message.attachments.map((attachment) => this.storage.delete(attachment.s3Key)));
    if (cleanup.some((result) => result.status === 'rejected')) this.logger.error('No se pudieron borrar todos los adjuntos del mensaje.');
    return updated;
  }
}
