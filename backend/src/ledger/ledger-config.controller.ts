import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { ChartAccountsService } from './chart/chart-accounts.service';
import {
  CreateChartAccountDto,
  UpdateChartAccountDto,
} from './chart/chart-accounts.dto';
import { BankAccountsService } from './banks/bank-accounts.service';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './banks/bank-accounts.dto';
import {
  AccountingSettingsService,
  UpdateAccountingSettingsDto,
} from './settings/accounting-settings.service';

/** Plan de cuentas de la finca: solo gestión. */
@Controller('estates/:estateId/chart-accounts')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class ChartAccountsController {
  constructor(private readonly chart: ChartAccountsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chart.list(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateChartAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chart.create(estateId, dto, user);
  }

  @Patch(':accountId')
  update(
    @Param('estateId') estateId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateChartAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chart.update(estateId, accountId, dto, user);
  }

  @Delete(':accountId')
  @HttpCode(204)
  remove(
    @Param('estateId') estateId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chart.remove(estateId, accountId, user);
  }
}

/** Cuentas bancarias de la comunidad: solo gestión. */
@Controller('estates/:estateId/bank-accounts')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class BankAccountsController {
  constructor(private readonly banks: BankAccountsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.banks.list(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.banks.create(estateId, dto, user);
  }

  @Patch(':bankAccountId')
  update(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.banks.update(estateId, bankAccountId, dto, user);
  }
}

/** Configuración contable (fecha de inicio): solo gestión. */
@Controller('estates/:estateId/accounting-settings')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class AccountingSettingsController {
  constructor(private readonly settings: AccountingSettingsService) {}

  @Get()
  get(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.get(estateId, user);
  }

  @Put()
  update(
    @Param('estateId') estateId: string,
    @Body() dto: UpdateAccountingSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.update(estateId, dto, user);
  }
}
