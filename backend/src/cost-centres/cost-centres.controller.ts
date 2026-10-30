import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CostCentresService } from './cost-centres.service';
import { CreateCostCentreDto } from './dto/create-cost-centre.dto';
import { UpdateCostCentreDto } from './dto/update-cost-centre.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

// Centros de coste — dimensión transversal de presupuestación (piscina,
// ascensor portal A...), gestión interna del administrador, nunca visible
// para rol C, igual que Presupuesto/Cuentas contables.
@Controller('estates/:estateId/cost-centres')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class CostCentresController {
  constructor(private readonly costCentresService: CostCentresService) {}

  @Get()
  list(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.costCentresService.listCostCentres(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateCostCentreDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costCentresService.createCostCentre(estateId, dto, user);
  }

  @Patch(':costCentreId')
  update(
    @Param('estateId') estateId: string,
    @Param('costCentreId') costCentreId: string,
    @Body() dto: UpdateCostCentreDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costCentresService.updateCostCentre(estateId, costCentreId, dto, user);
  }
}
