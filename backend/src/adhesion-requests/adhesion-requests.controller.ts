import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdhesionRequestsService } from './adhesion-requests.service';
import { RejectAdhesionDto } from './dto/reject-adhesion.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

/**
 * Vista transversal (dashboard "Solicitudes" del rol B) — sin `:estateId`
 * en la ruta, así que no puede vivir en `AdhesionRequestsController` (que
 * tiene el prefijo de clase fijo `estates/:estateId/...`). El scoping por
 * fincas accesibles ocurre en el servicio vía `EstateAccessService.scopedWhere`.
 */
@Controller('adhesion-requests')
export class AllAdhesionRequestsController {
  constructor(
    private readonly adhesionRequestsService: AdhesionRequestsService,
  ) {}

  @Get()
  listAllPending(@CurrentUser() user: AuthenticatedUser) {
    return this.adhesionRequestsService.listAllPending(user);
  }
}

@Controller('estates/:estateId/adhesion-requests')
@UseGuards(EstateScopeGuard)
export class AdhesionRequestsController {
  constructor(
    private readonly adhesionRequestsService: AdhesionRequestsService,
  ) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: 'pending',
  ) {
    return status === 'pending'
      ? this.adhesionRequestsService.listPendingByEstate(estateId, user)
      : this.adhesionRequestsService.listByEstate(estateId, user);
  }

  // Solo un rol B (admin de la gestora que gestiona la finca) puede
  // aprobar/rechazar adhesiones — un rol C nunca resuelve sus propias
  // solicitudes ni las de otros.
  @Post(':id/approve')
  @Roles('A', 'B')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adhesionRequestsService.approve(id, user);
  }

  @Post(':id/reject')
  @Roles('A', 'B')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectAdhesionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adhesionRequestsService.reject(id, user, dto.notes);
  }
}
