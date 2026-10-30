import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { StorageService } from '../files/storage.service';
import { DirectMessageAttachmentsService, type DirectMessageUpload } from './direct-message-attachments.service';

class SendAttachmentMessageDto {
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;
}

@Controller('direct-messages')
export class DirectMessageAttachmentsController {
  constructor(private readonly attachments: DirectMessageAttachmentsService) {}

  @Post('messages/with-attachments')
  @UseInterceptors(FilesInterceptor('files', 5, {
    defParamCharset: 'utf8',
    limits: { fileSize: StorageService.MAX_SIZE_BYTES, files: 5, fields: 3, fieldSize: 40 * 1024 },
  }))
  send(@Body() input: SendAttachmentMessageDto, @UploadedFiles() files: DirectMessageUpload[], @CurrentUser() user: AuthenticatedUser) {
    return this.attachments.send(input, files, user);
  }

  @Get('attachments/:id/file')
  async download(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser, @Res() response: Response) {
    const file = await this.attachments.download(id, user);
    const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.content);
  }
}
