import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { BudgetService } from './budget.service';
import { UpsertBudgetItemDto } from './upsert-budget-item.dto';
import { UpsertCostCentreBudgetDto } from './upsert-cost-centre-budget.dto';

function yearOf(value?: string): number {
  return value ? Number(value) : new Date().getFullYear();
}

/** Presupuesto por cuenta y su análisis: solo gestión. */
@Controller('estates/:estateId/budget')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateBudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.budget.listBudget(estateId, yearOf(fiscalYear), user);
  }

  @Post()
  upsert(
    @Param('estateId') estateId: string,
    @Body() dto: UpsertBudgetItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budget.upsertBudgetItem(estateId, dto, user);
  }

  @Get('analysis')
  analysis(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.budget.analysis(estateId, yearOf(fiscalYear), user);
  }
}

/** Presupuesto por centro de coste: solo gestión. */
@Controller('estates/:estateId/cost-centre-budget')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateCostCentreBudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.budget.listCostCentreBudget(estateId, yearOf(fiscalYear), user);
  }

  @Post()
  upsert(
    @Param('estateId') estateId: string,
    @Body() dto: UpsertCostCentreBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budget.upsertCostCentreBudget(estateId, dto, user);
  }
}
