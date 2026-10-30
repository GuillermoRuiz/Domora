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
import { PayrollService } from './payroll.service';
import {
  CreatePayrollDto,
  PayPayrollDto,
  PayrollReasonDto,
} from './payroll.dto';

/** Nóminas de la finca: solo gestión. */
@Controller('estates/:estateId/payroll')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstatePayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(
      estateId,
      { year: year && /^\d{4}$/.test(year) ? Number(year) : undefined },
      user,
    );
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreatePayrollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(estateId, dto, user);
  }
}

/** Pagar, deshacer el pago o anular una nómina: solo gestión. */
@Controller('payroll')
@Roles('A', 'B')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Post(':id/pay')
  @HttpCode(200)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayPayrollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.pay(id, dto, user);
  }

  @Post(':id/undo-payment')
  @HttpCode(200)
  undoPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayrollReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.undoPayment(id, dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayrollReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancel(id, dto, user);
  }
}
