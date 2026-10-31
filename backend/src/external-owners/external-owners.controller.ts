import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ExternalOwnersService } from './external-owners.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import {
  CreateExternalOwnerDto,
  UpdateExternalOwnerDto,
} from './dto/external-owner.dto';

// Solo gestora (B) o Domora (A): un titular externo lleva NIF, email,
// teléfono y dirección postal de un propietario sin cuenta. Sin @Roles, el
// RolesGuard deja pasar a cualquier rol y un vecino (C) de la finca podía
// listar los datos personales de todos los propietarios importados.
@Controller('estates/:estateId/external-owners')
@Roles('A', 'B')
export class EstateExternalOwnersController {
  constructor(private readonly externalOwnersService: ExternalOwnersService) {}

  @Get()
  @UseGuards(EstateScopeGuard)
  listByEstate(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalOwnersService.listByEstate(estateId, user);
  }
}

/** Alta de un titular en una propiedad concreta — la finca se resuelve desde la propiedad en el servicio. */
@Controller('properties/:propertyId/external-owners')
@Roles('A', 'B')
export class PropertyExternalOwnersController {
  constructor(private readonly externalOwnersService: ExternalOwnersService) {}

  @Post()
  create(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateExternalOwnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalOwnersService.create(propertyId, dto, user);
  }
}

@Controller('external-owners')
@Roles('A', 'B')
export class ExternalOwnersController {
  constructor(private readonly externalOwnersService: ExternalOwnersService) {}

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.externalOwnersService.findById(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExternalOwnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalOwnersService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.externalOwnersService.remove(id, user);
  }
}
