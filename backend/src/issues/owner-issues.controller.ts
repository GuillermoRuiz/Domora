import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateOwnerIssueDto,
  ListOwnerIssuesQuery,
  OwnerIssueReplyDto,
  RateIssueDto,
} from './dto/owner-issue.dto';
import { OwnerIssuesService } from './owner-issues.service';

/** «Incidencias» of the signed-in owner. Literal routes go before `:id`. */
@Controller('me/issues')
@Roles('C')
export class OwnerIssuesController {
  constructor(private readonly owners: OwnerIssuesService) {}

  @Get()
  list(
    @Query() query: ListOwnerIssuesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.list(user, query);
  }

  @Get('locations')
  locations(
    @Query('estateId', ParseUUIDPipe) estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.locations(estateId, user);
  }

  @Get('similar')
  similar(
    @Query('estateId', ParseUUIDPipe) estateId: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.similar(estateId, (q ?? '').slice(0, 200), user);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.detail(id, user);
  }

  @Post()
  create(
    @Body() dto: CreateOwnerIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.create(dto, user);
  }

  @Post(':id/replies')
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OwnerIssueReplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.reply(id, dto, user);
  }

  @Post(':id/withdraw')
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.withdraw(id, user);
  }

  @Post(':id/reopen')
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.reopen(id, user);
  }

  @Post(':id/rating')
  rate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.rate(id, dto, user);
  }

  @Put(':id/affected')
  markAffected(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.setAffected(id, true, user);
  }

  @Delete(':id/affected')
  unmarkAffected(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owners.setAffected(id, false, user);
  }
}
