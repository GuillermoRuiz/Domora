import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { EstateDashboardService } from './estate-dashboard.service';

/** Panel de la finca: solo gestión. El propietario ve lo suyo en sus propias pantallas. */
@Controller('estates/:estateId/dashboard')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateDashboardController {
  constructor(private readonly dashboard: EstateDashboardService) {}

  @Get('summary')
  summary(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(estateId, user);
  }

  @Get('cashflow')
  cashflow(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.dashboard.cashflow(estateId, user, year);
  }

  @Get('expense-breakdown')
  expenseBreakdown(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.dashboard.expenseBreakdown(estateId, user, year);
  }

  @Get('milestones')
  milestones(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.milestones(estateId, user);
  }

  @Get('activity')
  activity(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('subjects') subjects?: string,
  ) {
    const types = subjects
      ? subjects
          .split(',')
          .map((subject) => subject.trim())
          .filter(Boolean)
      : undefined;
    return this.dashboard.activity(estateId, user, limit, types);
  }

  @Get('properties')
  properties(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.dashboard.properties(estateId, user, limit);
  }

  @Get('property-statuses')
  propertyStatuses(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.propertyStatuses(estateId, user);
  }
}
