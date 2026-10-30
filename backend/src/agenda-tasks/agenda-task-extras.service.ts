import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { AuditService } from '../gdpr/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  MAX_ATTACHMENTS_PER_TASK,
  MAX_CHECKLIST_ITEMS,
} from './agenda-task.constants';
import { AgendaTasksService } from './agenda-tasks.service';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
export interface UploadedTaskFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Elementos que cuelgan de una tarea: comentarios, checklist y adjuntos.
 * Toda operación empieza por `AgendaTasksService.assertAccess`, que es quien
 * garantiza que la tarea es de la gestora del usuario y de una comunidad
 * accesible: aquí no se repite esa lógica de ámbito.
 */
@Injectable()
export class AgendaTaskExtrasService {
  private readonly logger = new Logger(AgendaTaskExtrasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: AgendaTasksService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ── Comentarios ─────────────────────────────────────────────────────────

  async addComment(taskId: string, text: string, user: AuthenticatedUser) {
    await this.tasks.assertAccess(taskId, user);
    const clean = text.trim();
    if (!clean) throw new BadRequestException('El comentario está vacío.');
    const comment = await this.prisma.agendaTaskComment.create({
      data: { taskId, authorUserId: user.id, text: clean },
      include: { author: { select: { id: true, fullName: true } } },
    });
    return {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      author: comment.author,
    };
  }

  /** Cada persona solo puede borrar sus propios comentarios. */
  async deleteComment(
    taskId: string,
    commentId: string,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    const comment = isUUID(commentId)
      ? await this.prisma.agendaTaskComment.findFirst({
          where: { id: commentId, taskId },
          select: { authorUserId: true },
        })
      : null;
    if (!comment) throw new NotFoundException('Comentario no encontrado.');
    if (comment.authorUserId !== user.id) {
      throw new ForbiddenException(
        'Solo puedes borrar tus propios comentarios.',
      );
    }
    await this.prisma.agendaTaskComment.delete({ where: { id: commentId } });
  }

  // ── Checklist ───────────────────────────────────────────────────────────

  async addChecklistItem(
    taskId: string,
    text: string,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    const clean = text.trim();
    if (!clean) throw new BadRequestException('El texto está vacío.');
    const count = await this.prisma.agendaTaskChecklistItem.count({
      where: { taskId },
    });
    if (count >= MAX_CHECKLIST_ITEMS) {
      throw new BadRequestException(
        `Una tarea admite como máximo ${MAX_CHECKLIST_ITEMS} subtareas.`,
      );
    }
    const last = await this.prisma.agendaTaskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const item = await this.prisma.agendaTaskChecklistItem.create({
      data: { taskId, text: clean, position: (last?.position ?? -1) + 1 },
    });
    return this.checklistView(item);
  }

  async updateChecklistItem(
    taskId: string,
    itemId: string,
    patch: { text?: string; done?: boolean },
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    await this.assertChecklistItem(taskId, itemId);
    const text = patch.text?.trim();
    if (patch.text !== undefined && !text) {
      throw new BadRequestException('El texto está vacío.');
    }
    const item = await this.prisma.agendaTaskChecklistItem.update({
      where: { id: itemId },
      data: { text, done: patch.done },
    });
    return this.checklistView(item);
  }

  async deleteChecklistItem(
    taskId: string,
    itemId: string,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    await this.assertChecklistItem(taskId, itemId);
    await this.prisma.agendaTaskChecklistItem.delete({ where: { id: itemId } });
  }

  private async assertChecklistItem(taskId: string, itemId: string) {
    const item = isUUID(itemId)
      ? await this.prisma.agendaTaskChecklistItem.findFirst({
          where: { id: itemId, taskId },
          select: { id: true },
        })
      : null;
    if (!item) throw new NotFoundException('Subtarea no encontrada.');
  }

  private checklistView(item: {
    id: string;
    text: string;
    done: boolean;
    position: number;
  }) {
    return {
      id: item.id,
      text: item.text,
      done: item.done,
      position: item.position,
    };
  }

  // ── Adjuntos ────────────────────────────────────────────────────────────

  async addAttachment(
    taskId: string,
    file: UploadedTaskFile | undefined,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    if (!file) {
      throw new BadRequestException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const count = await this.prisma.agendaTaskAttachment.count({
      where: { taskId },
    });
    if (count >= MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestException(
        `Una tarea admite como máximo ${MAX_ATTACHMENTS_PER_TASK} adjuntos.`,
      );
    }
    const s3Key = await this.storage.put(
      `agenda-tasks/${taskId}`,
      file.originalname,
      file.buffer,
    );
    let attachment;
    try {
      attachment = await this.prisma.agendaTaskAttachment.create({
        data: {
          taskId,
          fileName: file.originalname.slice(0, 255),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          s3Key,
          createdByUserId: user.id,
        },
      });
    } catch (error) {
      // Sin fila no habría quien referenciara el fichero: no se deja huérfano en disco.
      await this.discard(s3Key);
      throw error;
    }
    await this.audit.logAccess(
      user,
      'agenda_task',
      'attach',
      taskId,
      attachment.fileName.slice(0, 200),
    );
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  async readAttachment(
    taskId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    const attachment = await this.findAttachment(taskId, attachmentId);
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      content: await this.storage.get(attachment.s3Key),
    };
  }

  async deleteAttachment(
    taskId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ) {
    await this.tasks.assertAccess(taskId, user);
    const attachment = await this.findAttachment(taskId, attachmentId);
    await this.prisma.agendaTaskAttachment.delete({
      where: { id: attachment.id },
    });
    await this.discard(attachment.s3Key);
  }

  /**
   * Borra el fichero sin propagar el error: la fila (la fuente de verdad) ya está
   * resuelta y un fallo de disco no debe convertir un borrado correcto en un 500.
   */
  private async discard(s3Key: string): Promise<void> {
    await this.storage.delete(s3Key).catch((error: unknown) => {
      this.logger.warn(
        `No se pudo borrar el fichero ${s3Key}: ${String(error)}`,
      );
    });
  }

  private async findAttachment(taskId: string, attachmentId: string) {
    const attachment = isUUID(attachmentId)
      ? await this.prisma.agendaTaskAttachment.findFirst({
          where: { id: attachmentId, taskId },
        })
      : null;
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');
    return attachment;
  }
}
