import {
  Body,
  Controller,
  Get,
  NotFoundException,
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
import { MeetingVoteDelegationsService } from './meeting-vote-delegations.service';
import { CreateVoteDelegationDto } from './dto/create-vote-delegation.dto';
import { RevokeVoteDelegationDto } from './dto/revoke-vote-delegation.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Fichero multipart tal y como lo entrega multer — mismo tipo que en meetings.controller.ts. */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Sin @Roles a nivel de controller: la autorización fina (A/B siempre;
// rol C solo por sí mismo) vive en el servicio — mismo criterio que
// CommunicationsController para respuestas de comunicados.
@Controller('meetings/:meetingId/delegations')
export class MeetingVoteDelegationsController {
  constructor(private readonly delegationsService: MeetingVoteDelegationsService) {}

  @Get()
  list(@Param('meetingId') meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.delegationsService.list(meetingId, user);
  }

  @Get('eligible-delegators')
  eligibleDelegators(
    @Param('meetingId') meetingId: string,
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.delegationsService.listEligibleDelegators(meetingId, propertyId, user);
  }

  @Post()
  create(
    @Param('meetingId') meetingId: string,
    @Body() dto: CreateVoteDelegationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.delegationsService.create(meetingId, dto, user);
  }

  @Patch(':id/revoke')
  revoke(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @Body() dto: RevokeVoteDelegationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.delegationsService.revoke(meetingId, id, dto, user);
  }

  @Post(':id/document')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8' }))
  async uploadDocument(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new NotFoundException('No se recibió ningún fichero (campo "file").');
    }
    return this.delegationsService.uploadDocument(meetingId, id, file, user);
  }

  @Get(':id/document/file')
  async downloadDocument(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content } = await this.delegationsService.downloadDocument(meetingId, id, user);
    res.setHeader('Content-Disposition', 'attachment; filename="delegacion.pdf"');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);
  }
}
