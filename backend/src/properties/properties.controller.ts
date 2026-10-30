import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertyOverviewService } from './property-overview.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/properties.dto';
import { CreateEstateOnboardingRequestDto } from './dto/create-estate-onboarding-request.dto';
import { ResolveEstateOnboardingRequestDto } from './dto/resolve-estate-onboarding-request.dto';
import { CreateEstatePropertyDto } from './dto/create-estate-property.dto';

@Controller('estates/:estateId/properties')
@UseGuards(EstateScopeGuard)
export class EstatePropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  listByEstate(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.listByEstate(estateId, user);
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateEstatePropertyDto,
  ) {
    return this.propertiesService.createForEstate(estateId, dto);
  }

  // Autocompletar "asistentes" al convocar una junta.
  @Get('owner-emails')
  @Roles('A', 'B')
  listOwnerEmails(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.listOwnerEmails(estateId, user);
  }

  /** Previsualiza el reparto de coeficientes por m² — no escribe nada. */
  @Post('coefficients/preview-by-area')
  @Roles('A', 'B')
  previewQuotasByArea(@Param('estateId') estateId: string) {
    return this.propertiesService.previewQuotasByArea(estateId);
  }

  /** Aplica el reparto de coeficientes por m² (recalcula de nuevo, no confía en el preview del cliente). */
  @Post('coefficients/apply-by-area')
  @Roles('A', 'B')
  applyQuotasByArea(@Param('estateId') estateId: string) {
    return this.propertiesService.applyQuotasByArea(estateId);
  }
}

@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly overview: PropertyOverviewService,
  ) {}

  /** Fichas de «Mi comunidad» sobre todas las propiedades del propietario («Todas mis propiedades»). Va antes de `:id`. */
  @Get('my-overview')
  @Roles('C')
  myOverviewForAll(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.getOverviewForUser(user);
  }

  /** Fichas de «Mi comunidad» del propietario para esta propiedad (próximo recibo, solicitudes, próxima junta, documentos nuevos). */
  @Get(':id/my-overview')
  @Roles('C')
  myOverview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.overview.getOverview(id, user);
  }

  /** «Próximos eventos» de «Mi comunidad» para esta propiedad (juntas, vencimientos de recibo, reservas y revisiones de instalaciones). */
  @Get(':id/my-events')
  @Roles('C')
  myEvents(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.overview.getEvents(id, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.propertiesService.findById(id, user);
  }

  // Proyección enriquecida (Apéndice D). Por defecto resuelve la membresía
  // del propio usuario autenticado; `?viewerUserId=` permite a un rol
  // A/B consultar la vista tal y como la vería otro usuario (p. ej. para
  // atender una incidencia de soporte).
  @Get(':id/view')
  resolveView(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('viewerUserId') viewerUserId?: string,
  ) {
    return this.propertiesService.resolvePropertyView(
      id,
      user,
      viewerUserId ?? user.id,
    );
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Body() dto: CreatePropertyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.propertiesService.remove(id, user);
  }
}

@Controller('estate-onboarding-requests')
export class EstateOnboardingRequestsController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(
    @Body() dto: CreateEstateOnboardingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.createOnboardingRequest(dto, user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.propertiesService.listOnboardingRequests(user);
  }

  @Patch(':id')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveEstateOnboardingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propertiesService.resolveOnboardingRequest(id, dto, user);
  }
}
