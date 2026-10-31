import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OwnerDocumentsService } from './owner-documents.service';
import {
  MarkOwnerDocumentsReadDto,
  OwnerDocumentsQueryDto,
} from './dto/owner-documents.dto';

/** «Documentación» of the signed-in owner: read-only, inside the document visibility rule. */
@Controller('me/documents')
@Roles('C')
export class OwnerDocumentsController {
  constructor(private readonly owners: OwnerDocumentsService) {}

  @Get()
  list(
    @Query() query: OwnerDocumentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.list(user, query);
  }

  @Post('read')
  @HttpCode(200)
  markRead(
    @Body() dto: MarkOwnerDocumentsReadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.markRead(user, dto.documentIds);
  }
}
