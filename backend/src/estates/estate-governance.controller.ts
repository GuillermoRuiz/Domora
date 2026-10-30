import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateGovernanceService } from './estate-governance.service';
import { AppointOfficeTermDto, EndOfficeTermDto } from './dto/estate-office-term.dto';

@Controller('estates/:estateId/office-terms')
@Roles('A', 'B')
export class EstateGovernanceController {
  constructor(private readonly governance: EstateGovernanceService) {}
  @Get() list(@Param('estateId', ParseUUIDPipe) estateId: string, @CurrentUser() user: AuthenticatedUser) { return this.governance.list(estateId, user); }
  @Get('candidates') candidates(@Param('estateId', ParseUUIDPipe) estateId: string, @CurrentUser() user: AuthenticatedUser) { return this.governance.candidates(estateId, user); }
  @Post() appoint(@Param('estateId', ParseUUIDPipe) estateId: string, @Body() dto: AppointOfficeTermDto, @CurrentUser() user: AuthenticatedUser) { return this.governance.appoint(estateId, dto, user); }
  @Patch(':termId/end') end(@Param('estateId', ParseUUIDPipe) estateId: string, @Param('termId', ParseUUIDPipe) termId: string, @Body() dto: EndOfficeTermDto, @CurrentUser() user: AuthenticatedUser) { return this.governance.end(estateId, termId, dto, user); }
}
