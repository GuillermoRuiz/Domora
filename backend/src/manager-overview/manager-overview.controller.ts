import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ManagerKpisService } from './manager-kpis.service';
import { ManagerActivityService } from './manager-activity.service';
import { ManagerEconomicService } from './manager-economic.service';
import { ManagerMilestonesService } from './manager-milestones.service';
import { ManagerPerformanceService } from './manager-performance.service';
import { ManagerPendingService } from './manager-pending.service';

/**
 * «Vista general» del gestor (rol B). Sin `estateId` agrega todas sus fincas; con él,
 * solo esa (403 si no es suya). Solo lectura y sin refresco automático.
 */
@Controller('manager-overview')
@Roles('B')
export class ManagerOverviewController {
  constructor(
    private readonly kpis: ManagerKpisService,
    private readonly pending: ManagerPendingService,
    private readonly milestones: ManagerMilestonesService,
    private readonly economic: ManagerEconomicService,
    private readonly activity: ManagerActivityService,
    private readonly performance: ManagerPerformanceService,
  ) {}

  @Get('kpis')
  getKpis(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.kpis.kpis(user, estateId);
  }

  @Get('pending-today')
  getPendingToday(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.pending.pendingToday(user, estateId);
  }

  @Get('milestones')
  getMilestones(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.milestones.milestones(user, estateId);
  }

  @Get('economic-summary')
  getEconomicSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.economic.summary(user, estateId);
  }

  @Get('activity')
  getActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.activity.activity(user, estateId);
  }

  /** El Top 10 es siempre el de todas las fincas; `estateId` solo señala (o añade) la elegida. */
  @Get('performance')
  getPerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId', new ParseUUIDPipe({ optional: true })) estateId?: string,
  ) {
    return this.performance.ranking(user, estateId);
  }
}
