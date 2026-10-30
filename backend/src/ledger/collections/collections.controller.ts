import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { CollectionsService } from './collections.service';
import {
  ApplyAdvanceDto,
  ApplySuspenseDto,
  CreateCollectionDto,
  CreateSuspenseDto,
  ListCollectionsQuery,
  ReturnCollectionDto,
  UndoCollectionDto,
} from './collections.dto';

/** Cobros, anticipos e ingresos sin identificar de una finca: solo gestión. */
@Controller('estates/:estateId')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateCollectionsController {
  constructor(private readonly service: CollectionsService) {}

  @Get('collections')
  list(
    @Param('estateId') estateId: string,
    @Query() query: ListCollectionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(estateId, query, user);
  }

  @Post('collections')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateCollectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(estateId, dto, user);
  }

  @Post('advances/apply')
  @HttpCode(200)
  applyAdvance(
    @Param('estateId') estateId: string,
    @Body() dto: ApplyAdvanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.applyAdvance(estateId, dto, user);
  }

  @Get('property-accounts/:propertyId')
  propertyAccount(
    @Param('estateId') estateId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.propertyAccount(estateId, propertyId, user);
  }

  @Get('suspense')
  listSuspense(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listSuspense(estateId, user);
  }

  @Post('suspense')
  registerSuspense(
    @Param('estateId') estateId: string,
    @Body() dto: CreateSuspenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.registerSuspense(estateId, dto, user);
  }
}

/** Operaciones sobre un cobro concreto: solo gestión. */
@Controller('collections')
@Roles('A', 'B')
export class CollectionsController {
  constructor(private readonly service: CollectionsService) {}

  @Post(':id/undo')
  @HttpCode(200)
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoCollectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.undo(id, dto, user);
  }

  @Post(':id/return')
  @HttpCode(200)
  returnCollection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnCollectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.returnCollection(id, dto, user);
  }
}

/** Aplicar un ingreso sin identificar a una propiedad: solo gestión. */
@Controller('suspense')
@Roles('A', 'B')
export class SuspenseController {
  constructor(private readonly service: CollectionsService) {}

  @Post(':id/apply')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplySuspenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.applySuspense(id, dto, user);
  }
}

/** Historial de cobros de un recibo: gestión y el propietario del recibo. */
@Controller('receipts')
@Roles('A', 'B', 'C')
export class ReceiptHistoryController {
  constructor(private readonly service: CollectionsService) {}

  @Get(':id/history')
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.receiptHistory(id, user);
  }
}
