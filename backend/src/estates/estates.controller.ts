import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  StreamableFile,
  GoneException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ESTATE_PHOTO_MAX_BYTES, EstatesService } from './estates.service';
import { EstateSetupService } from './estate-setup.service';
import { CreateEstateDto, UpdateEstateDto } from './dto/create-estate.dto';
import { UpdateSepaBillingDto } from './dto/update-sepa-billing.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EstateOverviewService } from './estate-overview.service';
import {
  EstateOverviewQueryDto,
  EstateOverviewFilterDto,
  EstateManagementSearchQueryDto,
} from './dto/estate-overview.dto';
import { EstateOverviewExcelService } from './estate-overview-excel.service';
import { EstateCommunityService } from './estate-community.service';
import { IsOptional, IsString, MaxLength, isUUID } from 'class-validator';
import { SupportDespacho } from '../support-access/support-despacho.decorator';

/**
 * Role A despacho context (odd/tasks/role-a-panel.md S1): `?administratorId=`
 * narrows the listing to one despacho for role A; roles B and C ignore it
 * (they stay scoped by their own token).
 */
class EstateOverviewOfficeQueryDto extends EstateOverviewQueryDto {
  @IsOptional() @IsString() @MaxLength(64) administratorId?: string;
}

class EstateOverviewOfficeFilterDto extends EstateOverviewFilterDto {
  @IsOptional() @IsString() @MaxLength(64) administratorId?: string;
}

/**
 * The despacho filter only exists for role A, so only role A gets it validated;
 * for B and C it is dropped, as before the filter existed (a malformed value is
 * not an error for them). Without `?administratorId=`, role A is scoped to the
 * despacho of its support session (`SupportAccessGuard` already refused a
 * filter naming another despacho), so a listing never crosses despachos.
 */
function officeFilter(
  user: AuthenticatedUser,
  raw: string | undefined,
  supportDespacho: string | undefined,
): string | undefined {
  if (user.role !== 'A') return undefined;
  if (raw === undefined) return supportDespacho;
  if (!isUUID(raw))
    throw new BadRequestException('El despacho indicado no es válido.');
  return raw;
}

@Controller('estates')
export class EstatesController {
  constructor(
    private readonly estatesService: EstatesService,
    private readonly estateSetup: EstateSetupService,
    private readonly overviewService: EstateOverviewService,
    private readonly overviewExcel: EstateOverviewExcelService,
    private readonly community: EstateCommunityService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @SupportDespacho() supportDespacho: string | undefined,
    @Query('administratorId') administratorId?: string,
  ) {
    return this.estatesService.list(
      user,
      officeFilter(user, administratorId, supportDespacho),
    );
  }

  @Get('overview')
  @Roles('A', 'B')
  overview(
    @Query() query: EstateOverviewOfficeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @SupportDespacho() supportDespacho: string | undefined,
  ) {
    const scoped: EstateOverviewOfficeQueryDto = {
      ...query,
      administratorId: officeFilter(
        user,
        query.administratorId,
        supportDespacho,
      ),
    };
    return this.overviewService.overview(scoped, user);
  }

  @Get('management-search')
  @Roles('A', 'B')
  managementSearch(
    @Query() query: EstateManagementSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @SupportDespacho() supportDespacho: string | undefined,
  ) {
    // Role A searches only the despacho of its support session.
    return this.overviewService.search(
      query.q,
      user,
      officeFilter(user, undefined, supportDespacho),
    );
  }

  @Get('overview/export.xlsx')
  @Roles('A', 'B')
  async exportOverview(
    @Query() query: EstateOverviewOfficeFilterDto,
    @CurrentUser() user: AuthenticatedUser,
    @SupportDespacho() supportDespacho: string | undefined,
  ) {
    const scoped: EstateOverviewOfficeFilterDto = {
      ...query,
      administratorId: officeFilter(
        user,
        query.administratorId,
        supportDespacho,
      ),
    };
    const file = await this.overviewExcel.generate(scoped, user);
    return new StreamableFile(file.content, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }

  // Bloqueado: era un catálogo de TODAS las fincas (nombre, dirección y gestora) abierto a cualquier usuario
  // autenticado, para la vinculación del propietario. Esa vinculación se replanteará con otra solución; mientras,
  // la ruta se mantiene declarada (antes de ':estateId', que si no la tomaría como un id) solo para responder 410.
  @Get('search')
  search(): never {
    throw new GoneException('La búsqueda de comunidades no está disponible.');
  }

  // Igual que 'search': antes de ':estateId'. Vista de rol B (panel de fincas con
  // su progreso de puesta en marcha), reutilizada por el rol A dentro del despacho
  // seleccionado (odd/tasks/role-a-panel.md S1): A pasa `?administratorId=` (sin él,
  // el despacho de su sesión de soporte); B sigue con el despacho de su token e ignora el parámetro.
  @Get('setup-summary')
  @Roles('A', 'B')
  setupSummary(
    @CurrentUser() user: AuthenticatedUser,
    @SupportDespacho() supportDespacho: string | undefined,
    @Query('administratorId') administratorId?: string,
  ): Promise<
    Awaited<ReturnType<EstateSetupService['summaryForAdministrator']>>
  > {
    const office =
      user.role === 'A'
        ? officeFilter(user, administratorId, supportDespacho)
        : user.administratorId;
    if (!office) return Promise.resolve([]);
    return this.estateSetup.summaryForAdministrator(office);
  }

  @Get(':estateId')
  @UseGuards(EstateScopeGuard)
  findById(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.findById(estateId, user);
  }

  // Foto de la finca: la sube o la quita la gestora; la ve quien tenga acceso a la finca.
  @Post(':estateId/photo')
  @Roles('A', 'B')
  @UseGuards(EstateScopeGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ESTATE_PHOTO_MAX_BYTES } }),
  )
  uploadPhoto(
    @Param('estateId') estateId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.setPhoto(estateId, file, user);
  }

  @Delete(':estateId/photo')
  @Roles('A', 'B')
  @UseGuards(EstateScopeGuard)
  removePhoto(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.removePhoto(estateId, user);
  }

  /** «Mi comunidad»: datos de presentación de la finca y tres indicadores agregados (nunca datos de otros propietarios). */
  @Get(':estateId/community-summary')
  @Roles('A', 'B', 'C')
  @UseGuards(EstateScopeGuard)
  communitySummary(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.community.getSummary(estateId, user);
  }

  @Get(':estateId/photo')
  @UseGuards(EstateScopeGuard)
  async photo(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const photo = await this.estatesService.getPhoto(estateId, user);
    // El tipo sale de lo que guardó el servidor tras mirar el contenido; `nosniff` evita que el navegador lo reinterprete.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(photo.content, {
      type: photo.contentType,
      disposition: 'inline',
      length: photo.content.length,
    });
  }

  @Post()
  create(@Body() dto: CreateEstateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.estatesService.create(dto, user);
  }

  @Patch(':estateId')
  update(
    @Param('estateId') estateId: string,
    @Body() dto: UpdateEstateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.update(estateId, dto, user);
  }

  @Get(':estateId/setup-status')
  @Roles('A', 'B')
  @UseGuards(EstateScopeGuard)
  async setupStatus(@Param('estateId') estateId: string) {
    const status = await this.estateSetup.compute(estateId);
    if (!status)
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    return status;
  }

  @Get(':estateId/sepa-billing')
  @Roles('A', 'B')
  getSepaBilling(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.getSepaBilling(estateId, user);
  }

  @Patch(':estateId/sepa-billing')
  @Roles('A', 'B')
  updateSepaBilling(
    @Param('estateId') estateId: string,
    @Body() dto: UpdateSepaBillingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.estatesService.updateSepaBilling(estateId, dto, user);
  }
}
