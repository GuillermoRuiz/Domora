import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { CreateInspectionTypeDto } from './dto/create-inspection-type.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

@Controller('estates/:estateId/assets')
@UseGuards(EstateScopeGuard)
export class EstateAssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.listByEstate(estateId, user);
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.createAsset(estateId, dto, user);
  }

  @Patch(':assetId')
  @Roles('A', 'B')
  update(
    @Param('estateId') estateId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.updateAsset(estateId, assetId, dto, user);
  }
}

/** Panel de Instalaciones (solo gestión): activos con proveedor, revisiones, estado e incidencias. */
@Controller('estates/:estateId/installations')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateInstallationsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.listInstallations(estateId, user);
  }
}

@Controller('estates/:estateId/inspection-types')
@UseGuards(EstateScopeGuard)
export class EstateInspectionTypesController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.listInspectionTypes(estateId, user);
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateInspectionTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assetsService.createInspectionType(estateId, dto, user);
  }
}
