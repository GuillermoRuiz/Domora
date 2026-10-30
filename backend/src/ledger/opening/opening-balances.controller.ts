import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { OpeningBalancesService } from './opening-balances.service';
import {
  ConfirmNoPriorBalancesDto,
  PostOpeningDto,
  SaveOpeningDraftDto,
} from './opening-balances.dto';

/** Saldos iniciales de la finca: solo gestión (ver EstateSetupService para el paso derivado). */
@Controller('estates/:estateId/opening-balances')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class OpeningBalancesController {
  constructor(private readonly service: OpeningBalancesService) {}

  @Get()
  get(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.get(estateId, user);
  }

  @Put()
  saveDraft(
    @Param('estateId') estateId: string,
    @Body() dto: SaveOpeningDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveDraft(estateId, dto, user);
  }

  @Post('validate')
  @HttpCode(200)
  validate(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.validate(estateId, user);
  }

  @Post('post')
  post(
    @Param('estateId') estateId: string,
    @Body() dto: PostOpeningDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.post(estateId, dto, user);
  }

  @Post('repost')
  repost(
    @Param('estateId') estateId: string,
    @Body() dto: PostOpeningDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.repost(estateId, dto, user);
  }

  @Post('no-prior-balances')
  confirmNoPriorBalances(
    @Param('estateId') estateId: string,
    @Body() dto: ConfirmNoPriorBalancesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmNoPriorBalances(estateId, dto, user);
  }
}
