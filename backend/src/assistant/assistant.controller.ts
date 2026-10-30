import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AssistantService } from './assistant.service';
import {
  ASSISTANT_CHANNELS,
  AskAssistantDto,
  type AssistantChannel,
} from './dto/ask-assistant.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

class ListAssistantMessagesQuery {
  @IsIn(ASSISTANT_CHANNELS)
  channel!: AssistantChannel;

  @IsOptional()
  @IsUUID()
  estateId?: string;
}

class ReindexDocumentDto {
  @IsOptional()
  @IsBoolean()
  reprocess?: boolean;
}
// Cada pregunta cuesta llamadas a OpenAI: tope por IP más estricto que el global.
const ASK_THROTTLE = { global: { limit: 20, ttl: 60_000 } };

/** Asistente de Domora (RAG): Domora Intelligence y Domo en Mensajes. Roles A, B y C. */
@Controller('assistant')
@Roles('A', 'B', 'C')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('documents/:id/index')
  @Roles('A', 'B')
  @Throttle(ASK_THROTTLE)
  indexDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReindexDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistant.indexDocument(id, user, dto.reprocess ?? false);
  }

  @Delete('documents/:id/index')
  @Roles('A', 'B')
  deleteDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistant.deleteRagDocument(id, user);
  }

  @Get('estates')
  listEstates(@CurrentUser() user: AuthenticatedUser) {
    return this.assistant.listEstates(user);
  }

  @Post('ask')
  @Throttle(ASK_THROTTLE)
  ask(@Body() dto: AskAssistantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.ask(dto, user);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @Param('id') id: string,
    @Query() query: ListAssistantMessagesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistant.listMessages(id, query.channel, user, query.estateId);
  }
}
