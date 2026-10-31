import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupportSessionsService } from './support-sessions.service';
import { StaffAuditService } from './staff-audit.service';
import { StartSupportSessionDto } from './dto/start-support-session.dto';
import { StaffAuditQueryDto } from './dto/staff-audit-query.dto';

/** Support mode of Domora staff on one despacho (odd/tasks/role-a-panel.md S5). */
@Controller('support-sessions')
@Roles('A')
export class SupportSessionsController {
  constructor(private readonly sessions: SupportSessionsService) {}

  @Post()
  start(
    @Body() dto: StartSupportSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.start(user.id, dto);
  }

  @Post(':id/end')
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.end(user.id, id);
  }

  /** The caller's own active sessions. */
  @Get('active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.listActive(user.id);
  }
}

/** Staff access log for the «Seguridad y auditoría» screen (role A). */
@Controller('staff-audit')
@Roles('A')
export class StaffAuditController {
  constructor(private readonly audit: StaffAuditService) {}

  @Get()
  list(@Query() query: StaffAuditQueryDto) {
    return this.audit.list(query);
  }
}
