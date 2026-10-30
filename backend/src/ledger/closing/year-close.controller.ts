import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { YearCloseService } from './year-close.service';
import { ApplyResultDto, ReopenFiscalYearDto } from './year-close.dto';

/** Cierre de ejercicio real: regularización, dotación, cierre por dimensión y apertura de N+1 (fase 11). */
@Controller('estates/:estateId/fiscal-years')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class YearCloseController {
  constructor(private readonly service: YearCloseService) {}

  @Get(':year/close-preconditions')
  preconditions(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.preconditions(estateId, Number(year), user);
  }

  @Post(':year/close')
  close(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.close(estateId, Number(year), user);
  }

  @Post(':year/reopen')
  reopen(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @Body() dto: ReopenFiscalYearDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reopen(estateId, Number(year), dto, user);
  }

  @Post(':year/apply-result')
  applyResult(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @Body() dto: ApplyResultDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.applyResult(estateId, Number(year), dto, user);
  }
}
