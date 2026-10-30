import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ResourcesService } from './resources.service';
import {
  AddCommunicationReplyDto,
  CreateCommunicationDto,
  CreateDocumentDto,
  MarkResourceReadDto,
  SetCommunicationArchivedDto,
  SetCommunicationPinnedDto,
  UpdateCommunicationDto,
  UploadCommunicationAttachmentDto,
} from './dto/resources.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { StorageService } from '../files/storage.service';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('estates/:estateId/communications')
@UseGuards(EstateScopeGuard)
export class EstateCommunicationsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('filter') filter?: 'active' | 'archived' | 'all',
  ) {
    return this.resourcesService.listCommunications(estateId, user, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      filter,
    });
  }

  @Post()
  @Roles('A', 'B', 'C')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateCommunicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.createCommunication(estateId, dto, user);
  }
}

/**
 * Endpoints por id, fuera del scope de `:estateId` (edición/baja/archivado
 * calzan mejor acá que repitiendo el prefijo de finca — la finca se resuelve
 * a partir del propio comunicado en el servicio).
 */
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommunicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.updateCommunication(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.deleteCommunication(id, user);
  }

  @Patch(':id/archive')
  @Roles('A', 'B')
  setArchived(
    @Param('id') id: string,
    @Body() dto: SetCommunicationArchivedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.setCommunicationArchived(
      id,
      dto.archived,
      user,
    );
  }

  @Patch(':id/pin')
  @Roles('A', 'B')
  setPinned(
    @Param('id') id: string,
    @Body() dto: SetCommunicationPinnedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.setCommunicationPinned(id, dto.pinned, user);
  }

  /** Quién ha leído este comunicado — A/B únicamente, defensa/engagement. */
  @Get(':id/reads')
  @Roles('A', 'B')
  listReads(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.listCommunicationReads(id, user);
  }

  // Responder es para cualquier rol con acceso — sin @Roles, mismo criterio
  // que IssuesController POST /issues/:id/timeline.
  @Post(':id/replies')
  addReply(
    @Param('id') id: string,
    @Body() dto: AddCommunicationReplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.addCommunicationReply(id, dto, user);
  }

  @Delete(':id/replies/:replyId')
  deleteReply(
    @Param('id') id: string,
    @Param('replyId') replyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.deleteCommunicationReply(id, replyId, user);
  }
}

@Controller('communications/:id/attachments')
export class CommunicationAttachmentsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.listCommunicationAttachments(id, user);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: StorageService.MAX_SIZE_BYTES } }),
  )
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: UploadedMulterFile,
    @Body() dto: UploadCommunicationAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new NotFoundException('No se recibió ningún fichero (campo "file").');
    }
    return this.resourcesService.uploadCommunicationAttachment(id, file, dto.title, user);
  }

  @Get(':attachmentId/file')
  async download(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { title, content } = await this.resourcesService.downloadCommunicationAttachment(
      id,
      attachmentId,
      user,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}"`);
    res.send(content);
  }
}

@Controller('estates/:estateId/documents')
@UseGuards(EstateScopeGuard)
export class EstateDocumentsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resourcesService.listDocuments(estateId, user, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.createDocument(estateId, dto, user);
  }
}

@Controller('resource-reads')
export class ResourceReadsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Post()
  markRead(
    @Body() dto: MarkResourceReadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resourcesService.markReadAs(user, dto.sourceType, dto.sourceId);
  }
}

// La campana del TopBar reutiliza este feed con un badge de conteo — sin
// pantalla ni endpoint nuevos (decisión del plan, sección Fase 9).
@Controller('alerts')
export class AlertsController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number(limit) : undefined;
    const safeLimit =
      parsed && Number.isInteger(parsed) && parsed > 0
        ? Math.min(parsed, 50)
        : undefined;
    return this.resourcesService.listAlerts(user, safeLimit);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.markAllAlertsRead(user);
  }
}

@Controller('activity')
export class ActivityController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.resourcesService.listActivity(
      user,
      limit ? Number(limit) : undefined,
    );
  }
}
