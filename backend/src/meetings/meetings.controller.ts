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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MeetingsService } from './meetings.service';
import {
  ConvocatoriaPreviewDto,
  CreateMeetingDto,
} from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { UpdateMeetingStateDto } from './dto/update-meeting-state.dto';
import { UpdateMeetingStatusDto } from './dto/update-meeting-status.dto';
import { PostChatMessageDto } from './dto/post-chat-message.dto';
import { PresenceHeartbeatDto } from './dto/presence-heartbeat.dto';
import { RecordAttendanceDto } from './dto/record-attendance.dto';
import { MarkRollCallDto } from './dto/mark-roll-call.dto';
import { SignActaAsSelfDto, SignActaDto } from './dto/sign-acta.dto';
import { SaveActaVersionDto } from './dto/save-acta-version.dto';
import { UpdateAgendaItemCommentsDto } from './dto/update-agenda-item-comments.dto';
import { UpdateRequire2faDto } from './dto/update-require-2fa.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer) — mismo tipo que en files.controller.ts. */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

class UploadMeetingAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

@Controller('estates/:estateId/meetings')
@UseGuards(EstateScopeGuard)
export class EstateMeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listByEstate(estateId, user);
  }

  /** Convocatoria habitual redactada con los datos del borrador: el paso 3 del alta la ofrece para editarla. */
  @Post('convocatoria-preview')
  @Roles('A', 'B')
  previewConvocatoria(
    @Param('estateId') estateId: string,
    @Body() dto: ConvocatoriaPreviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.previewConvocatoria(estateId, dto, user);
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.create(estateId, dto, user);
  }

  /** Sin gating de rol — igual criterio que el quórum en vivo: visible a cualquiera con acceso a la finca. */
  @Get('participation-history')
  participationHistory(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.getParticipationHistory(estateId, user);
  }
}

// Endpoints por id de junta: el estate se resuelve y valida dentro del
// service (findMeetingOrThrow -> assertAccess), no en un guard de ruta —
// mismo patrón que AmenitiesController para /availability, /blackouts, etc.
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.findOne(id, user);
  }

  /** Edición de los datos de una junta aún convocada (título, fechas, lugar, orden del día…). */
  @Patch(':id')
  @Roles('A', 'B')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.update(id, dto, user);
  }

  /** Da por tratado un punto del orden del día que no lleva votación. */
  @Patch(':id/agenda/:itemId/treated')
  @Roles('A', 'B')
  markAgendaItemTreated(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.markAgendaItemTreated(id, itemId, user);
  }

  /** Quita la marca de «tratado» de un punto sin votación. */
  @Delete(':id/agenda/:itemId/treated')
  @Roles('A', 'B')
  clearAgendaItemTreated(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.clearAgendaItemTreated(id, itemId, user);
  }

  /** Comentarios del administrador sobre un punto del orden del día (salen en el acta). */
  @Patch(':id/agenda/:itemId/comments')
  @Roles('A', 'B')
  setAgendaItemComments(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateAgendaItemCommentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.setAgendaItemComments(
      id,
      itemId,
      dto.comments,
      user,
    );
  }

  /** Histórico de versiones del texto del acta (de la más reciente a la más antigua). */
  @Get(':id/acta-versions')
  @Roles('A', 'B')
  listActaVersions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listActaVersions(id, user);
  }

  /** Guarda una nueva versión del acta (y deja esos textos como los vigentes). */
  @Post(':id/acta-versions')
  @Roles('A', 'B')
  saveActaVersion(
    @Param('id') id: string,
    @Body() dto: SaveActaVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.saveActaVersion(id, dto, user);
  }

  // Se sondea cada pocos segundos desde la sala de espera / panel de
  // anfitrión (sin WebSocket todavía — ver plan, decisión #3).
  @Get(':id/state')
  getState(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.getState(id, user);
  }

  @Patch(':id/state')
  @Roles('A', 'B')
  updateState(
    @Param('id') id: string,
    @Body() dto: UpdateMeetingStateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.updateState(id, dto, user);
  }

  // Cierre de la junta (`convocada` → `celebrada` | `cancelada`), terminal.
  // Distinto de `:id/state`, que es el estado mutable de la videollamada.
  @Patch(':id/status')
  @Roles('A', 'B')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMeetingStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.updateStatus(id, dto, user);
  }

  @Post(':id/heartbeat')
  @Roles('A', 'B')
  heartbeatAdmin(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.heartbeatAdmin(id, user);
  }

  @Post(':id/attendance')
  recordAttendance(
    @Param('id') id: string,
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.recordAttendance(id, dto, user);
  }

  @Get(':id/attendance')
  listAttendance(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listAttendance(id, user);
  }

  /** Propiedades propias + delegaciones del usuario para esta junta — puebla el selector de la sala de espera. */
  @Get(':id/attendance/options')
  myAttendanceOptions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listMyAttendanceOptions(id, user);
  }

  /** Visible a cualquiera con acceso a la finca — mismo criterio de transparencia que `:id/presence`. */
  @Get(':id/quorum')
  getQuorum(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.getQuorum(id, user);
  }

  @Get(':id/roll-call/eligible')
  @Roles('A', 'B')
  rollCallEligible(
    @Param('id') id: string,
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listRollCallEligible(id, propertyId, user);
  }

  @Get(':id/roll-call/holders')
  @Roles('A', 'B')
  rollCallHolders(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listRollCallHolders(id, user);
  }

  @Post(':id/roll-call')
  @Roles('A', 'B')
  markRollCall(
    @Param('id') id: string,
    @Body() dto: MarkRollCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.markRollCall(id, dto, user);
  }

  @Delete(':id/roll-call/:attendanceId')
  @Roles('A', 'B')
  undoRollCall(
    @Param('id') id: string,
    @Param('attendanceId') attendanceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.undoRollCall(id, attendanceId, user);
  }

  @Get(':id/chat')
  listChat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.listChatMessages(id, user);
  }

  @Post(':id/chat')
  postChat(
    @Param('id') id: string,
    @Body() dto: PostChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.postChatMessage(id, dto, user);
  }

  @Get(':id/presence')
  listPresence(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listPresence(id, user);
  }

  @Post(':id/presence')
  heartbeatPresence(
    @Param('id') id: string,
    @Body() dto: PresenceHeartbeatDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.heartbeatPresence(id, dto, user);
  }

  /** Convocatoria en `.docx`, generada al vuelo — no se persiste (ver ConvocatoriaDocxService). */
  @Get(':id/convocatoria.docx')
  async convocatoriaDocx(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { fileName, content } =
      await this.meetingsService.generateConvocatoriaDocx(id, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(content);
  }

  /** Firma el acta (art. 19 LPH) — genera y persiste el .docx cuando presidente Y secretario ya firmaron. */
  @Post(':id/acta/sign')
  @Roles('A', 'B')
  signActa(
    @Param('id') id: string,
    @Body() dto: SignActaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.signActa(id, dto, user);
  }

  /** Firma quien está conectado: el presidente de la comunidad o un administrador de finca. */
  @Post(':id/acta/sign-self')
  signActaAsSelf(
    @Param('id') id: string,
    @Body() dto: SignActaAsSelfDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.signActaAsSelf(id, dto.role, user);
  }

  /** Estado de las firmas y si quien consulta puede firmar ahora (acta lista y su turno). */
  @Get(':id/acta/signing')
  actaSigning(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.getActaSigning(id, user);
  }

  @Get(':id/acta.docx')
  async actaDocx(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } =
      await this.meetingsService.downloadActa(id, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  /** Distribuye el acta ya firmada a todos los propietarios vinculados de la finca (art. 19 LPH). */
  @Post(':id/acta/send')
  @Roles('A', 'B')
  sendActaNotice(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.sendActaNotice(id, user);
  }

  /** Solo editable antes de que exista ninguna VoteSession — ver MeetingsService.updateRequire2fa. */
  @Patch(':id/require-2fa-for-voting')
  @Roles('A', 'B')
  updateRequire2fa(
    @Param('id') id: string,
    @Body() dto: UpdateRequire2faDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.updateRequire2fa(id, dto, user);
  }
}

@Controller('meetings/:meetingId/attachments')
export class MeetingAttachmentsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingsService.listAttachments(meetingId, user);
  }

  @Post()
  @Roles('A', 'B')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8' }))
  async upload(
    @Param('meetingId') meetingId: string,
    @UploadedFile() file: UploadedMulterFile,
    @Body() dto: UploadMeetingAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new NotFoundException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    return this.meetingsService.uploadAttachment(
      meetingId,
      file,
      dto.title,
      user,
    );
  }

  @Delete(':attachmentId')
  @Roles('A', 'B')
  async remove(
    @Param('meetingId') meetingId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.meetingsService.deleteAttachment(meetingId, attachmentId, user);
    return { deleted: true };
  }

  @Get(':attachmentId/file')
  async download(
    @Param('meetingId') meetingId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { title, content } = await this.meetingsService.downloadAttachment(
      meetingId,
      attachmentId,
      user,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(title)}"`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);
  }
}
