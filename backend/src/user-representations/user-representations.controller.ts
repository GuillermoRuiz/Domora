import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRepresentationsService } from './user-representations.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

// El `:userId` de la ruta NO es de fiar por sí solo: la autorización la
// aplica el servicio comparándolo con el usuario autenticado (mismo
// criterio que el resto de servicios con `assertAccess`).
@Controller('users/:userId/representations')
export class UserRepresentationsController {
  constructor(
    private readonly representationsService: UserRepresentationsService,
  ) {}

  @Get('active')
  listActive(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.representationsService.listActiveFor(userId, user);
  }

  @Get('can-act-on-behalf-of/:representedUserId')
  canActOnBehalfOf(
    @Param('userId') userId: string,
    @Param('representedUserId') representedUserId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('estateId') estateId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.representationsService
      .canActOnBehalfOf(userId, representedUserId, user, {
        estateId,
        propertyId,
      })
      .then((canAct) => ({ canAct }));
  }
}
