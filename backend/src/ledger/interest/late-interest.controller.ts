import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { LateInterestService } from './late-interest.service';
import { LatePaymentInterestPoliciesService } from './late-interest-policies.service';
import {
  CloseLatePaymentInterestPolicyDto,
  CreateLatePaymentInterestPolicyDto,
  LateInterestRequestDto,
} from './late-interest.dto';

/** Liquidación de intereses de demora, bajo demanda (fase 10). */
@Controller('estates/:estateId/late-interest')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class LateInterestController {
  constructor(private readonly service: LateInterestService) {}

  @Post('preview')
  @HttpCode(200)
  preview(
    @Param('estateId') estateId: string,
    @Body() dto: LateInterestRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.preview(estateId, dto.receiptId, dto.asOfDate, user);
  }

  @Post('accrue')
  accrue(
    @Param('estateId') estateId: string,
    @Body() dto: LateInterestRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.accrue(estateId, dto.receiptId, dto.asOfDate, user);
  }
}

/** Tipos de interés de demora vigentes en la finca (fase 10). */
@Controller('estates/:estateId/late-interest-policies')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class LateInterestPoliciesController {
  constructor(private readonly service: LatePaymentInterestPoliciesService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateLatePaymentInterestPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(estateId, dto, user);
  }

  @Patch(':id')
  close(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @Body() dto: CloseLatePaymentInterestPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.close(estateId, id, dto, user);
  }
}
