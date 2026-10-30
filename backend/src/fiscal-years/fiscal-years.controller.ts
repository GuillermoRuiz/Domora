import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { ApproveFiscalYearDto } from './dto/approve-fiscal-year.dto';
import { UpdateFiscalYearReserveDto } from './dto/update-fiscal-year-reserve.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

@Controller('estates/:estateId/fiscal-years')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class FiscalYearsController {
  constructor(private readonly fiscalYearsService: FiscalYearsService) {}

  @Get()
  list(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fiscalYearsService.listFiscalYears(estateId, user);
  }

  @Get(':year')
  get(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fiscalYearsService.getFiscalYear(estateId, Number(year), user);
  }

  @Post(':year/approve')
  approve(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @Body() dto: ApproveFiscalYearDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fiscalYearsService.approveFiscalYear(estateId, Number(year), dto, user);
  }

  /** Fondo de reserva del ejercicio: modo y porcentaje de cada recibo. */
  @Patch(':year/reserve')
  updateReserve(
    @Param('estateId') estateId: string,
    @Param('year') year: string,
    @Body() dto: UpdateFiscalYearReserveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fiscalYearsService.updateReserve(estateId, Number(year), dto, user);
  }
}
