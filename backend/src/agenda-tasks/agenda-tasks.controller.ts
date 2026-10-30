import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { StorageService } from '../files/storage.service';
import { isTerminal } from './agenda-task.constants';
import { AgendaTasksService } from './agenda-tasks.service';
import { AgendaTaskResolutionService } from './agenda-task-resolution.service';
import {
  AgendaTaskExtrasService,
  type UploadedTaskFile,
} from './agenda-task-extras.service';
import { CreateAgendaTaskDto } from './dto/create-agenda-task.dto';
import { UpdateAgendaTaskDto } from './dto/update-agenda-task.dto';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AgendaSummaryQueryDto,
  CreateLabelDto,
  ListAgendaTasksQueryDto,
  ResolveAgendaTaskDto,
  UpdateChecklistItemDto,
  UpdateTaskStatusDto,
} from './dto/misc.dto';

/** Cabecera que avisa de que la respuesta se truncó por un tope de seguridad (ver `main.ts`: CORS). */
export const TRUNCATED_HEADER = 'X-Agenda-Truncated';

/**
 * Agenda de tareas de la gestora. Solo rol B: la agenda es interna, nunca la
 * ven propietarios (rol C) ni soporte (rol A, que no pertenece a ninguna
 * gestora). El ámbito por gestora y por comunidad lo aplican los servicios.
 *
 * Las rutas estáticas (`summary`, `labels`, `assignees`) van ANTES de `:id`
 * para que no las capture el parámetro.
 */
@Controller('agenda')
@Roles('B')
export class AgendaTasksController {
  constructor(
    private readonly tasks: AgendaTasksService,
    private readonly extras: AgendaTaskExtrasService,
    private readonly resolution: AgendaTaskResolutionService,
  ) {}

  // ── Catálogos ───────────────────────────────────────────────────────────

  @Get('assignees')
  assignees(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.listAssignees(user);
  }

  @Get('labels')
  labels(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.listLabels(user);
  }

  @Post('labels')
  createLabel(
    @Body() dto: CreateLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.createLabel(dto.name, user);
  }

  @Delete('labels/:id')
  @HttpCode(204)
  async deleteLabel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.tasks.deleteLabel(id, user);
  }

  // ── Tareas ──────────────────────────────────────────────────────────────

  /**
   * Devuelve la lista como array (contrato estable). Si se alcanzó un tope de
   * seguridad lo avisa en la cabecera `X-Agenda-Truncated` para que el cliente
   * no presente como completo un calendario al que le faltan tareas.
   */
  @Get('tasks')
  async list(
    @Query() query: ListAgendaTasksQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.tasks.list(user, query);
    if (result.truncated) res.setHeader(TRUNCATED_HEADER, 'true');
    return result.items;
  }

  @Get('tasks/summary')
  summary(
    @Query() query: AgendaSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.summary(user, query);
  }

  @Post('tasks')
  create(
    @Body() dto: CreateAgendaTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.create(dto, user);
  }

  @Get('tasks/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.getById(id, user);
  }

  @Patch('tasks/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAgendaTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.update(id, dto, user);
  }

  @Patch('tasks/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Una revisión de incidencia no se cierra a secas: se resuelve indicando el siguiente paso (`POST …/resolution`).
    if (dto.status === 'COMPLETADA') {
      const task = await this.tasks.assertAccess(id, user);
      if (task.kind === 'review_issue' && !isTerminal(task.status))
        throw new BadRequestException({
          code: 'REVIEW_NEEDS_NEXT_STEP',
          message:
            'Una revisión se resuelve indicando el siguiente paso: tarea, espera, visita, vía o resuelta.',
        });
    }
    return this.tasks.updateStatus(id, dto, user);
  }

  /** Resuelve una tarea de decisión (aprobar, confirmar…): la única forma de cerrarla. */
  @Post('tasks/:id/resolution')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAgendaTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resolution.resolve(id, dto.result, user);
  }

  @Post('tasks/:id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.duplicate(id, user);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.tasks.remove(id, user);
  }

  // ── Comentarios ─────────────────────────────────────────────────────────

  @Post('tasks/:id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extras.addComment(id, dto.text, user);
  }

  @Delete('tasks/:id/comments/:commentId')
  @HttpCode(204)
  async deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.extras.deleteComment(id, commentId, user);
  }

  // ── Checklist ───────────────────────────────────────────────────────────

  @Post('tasks/:id/checklist')
  addChecklistItem(
    @Param('id') id: string,
    @Body() dto: AddChecklistItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extras.addChecklistItem(id, dto.text, user);
  }

  @Patch('tasks/:id/checklist/:itemId')
  updateChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extras.updateChecklistItem(id, itemId, dto, user);
  }

  @Delete('tasks/:id/checklist/:itemId')
  @HttpCode(204)
  async deleteChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.extras.deleteChecklistItem(id, itemId, user);
  }

  // ── Adjuntos ────────────────────────────────────────────────────────────

  @Post('tasks/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: UploadedTaskFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extras.addAttachment(id, file, user);
  }

  @Get('tasks/:id/attachments/:attachmentId/file')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.extras.readAttachment(id, attachmentId, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.content);
  }

  @Delete('tasks/:id/attachments/:attachmentId')
  @HttpCode(204)
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.extras.deleteAttachment(id, attachmentId, user);
  }
}
