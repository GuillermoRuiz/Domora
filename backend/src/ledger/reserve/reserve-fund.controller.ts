import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import {
  CancelReserveFundApplicationDto,
  CreateReserveFundApplicationDto,
  ReserveFundService,
} from './reserve-fund.service';

/** Uso del fondo de reserva de la finca (art. 9.1.f LPH): solo gestión. */
@Controller('estates/:estateId/reserve-fund-applications')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateReserveFundController {
  constructor(private readonly reserveFund: ReserveFundService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserveFund.list(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateReserveFundApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserveFund.create(estateId, dto, user);
  }
}

/** Deshacer una liberación registrada por error: solo gestión. */
@Controller('reserve-fund-applications')
@Roles('A', 'B')
export class ReserveFundController {
  constructor(private readonly reserveFund: ReserveFundService) {}

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReserveFundApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserveFund.cancel(id, dto, user);
  }
}
