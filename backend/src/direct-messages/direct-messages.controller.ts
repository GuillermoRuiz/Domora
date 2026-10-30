import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageEditsService } from './direct-message-edits.service';
import { UpdateDirectMessageDto } from './dto/update-direct-message.dto';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { UpdateUserMessagingSettingsDto } from './dto/update-user-messaging-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('direct-messages')
export class DirectMessagesController {
  constructor(
    private readonly directMessagesService: DirectMessagesService,
    private readonly edits: DirectMessageEditsService,
  ) {}

  // Ajustes globales (rol A/B, sin PropertyMembership) — declarado antes de
  // 'contacts'/'conversations' porque son literales fijos, no hay conflicto
  // de rutas, pero se agrupa acá por afinidad temática.
  @Get('settings')
  getMySettings(@CurrentUser() user: AuthenticatedUser) {
    return this.directMessagesService.getMySettings(user);
  }

  @Patch('settings')
  updateMySettings(
    @Body() dto: UpdateUserMessagingSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.directMessagesService.updateMySettings(user, dto);
  }

  @Get('contacts')
  listContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.directMessagesService.listContacts(user, estateId);
  }

  @Get('conversations')
  listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.directMessagesService.listConversations(user, estateId);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.directMessagesService.listMessages(id, user, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Post('messages')
  sendMessage(
    @Body() dto: SendDirectMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.directMessagesService.sendMessage(dto, user);
  }

  @Patch('messages/:id')
  editMessage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDirectMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.edit(id, dto.text, user);
  }

  @Delete('messages/:id')
  deleteMessage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.remove(id, user);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  hideConversation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.directMessagesService.hideConversation(id, user);
  }

  @Patch('conversations/:id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.directMessagesService.markRead(id, user);
  }
}
