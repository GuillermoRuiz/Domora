import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CatastroService } from './catastro.service';
import { LookupCatastroDto } from './dto/lookup-catastro.dto';
import { ImportCatastroDto } from './dto/import-catastro.dto';
import {
  MunicipalitiesQueryDto,
  StreetsQueryDto,
} from './dto/catalog-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

/**
 * Cada consulta consume cupo de la IP del servidor contra el Catastro (7.200
 * peticiones/hora, con bloqueo de 4 h al pasarse), así que las rutas que
 * llegan al servicio externo llevan un tope por IP más estricto que el global.
 */
const CATASTRO_THROTTLE = { global: { limit: 20, ttl: 60_000 } };

@Controller('catastro')
@Roles('A', 'B')
export class CatastroCatalogController {
  constructor(private readonly catastro: CatastroService) {}

  @Get('provinces')
  @Throttle(CATASTRO_THROTTLE)
  provinces() {
    return this.catastro.provinces();
  }

  @Get('municipalities')
  @Throttle(CATASTRO_THROTTLE)
  municipalities(@Query() query: MunicipalitiesQueryDto) {
    return this.catastro.municipalities(query.province, query.q ?? '');
  }

  @Get('streets')
  @Throttle(CATASTRO_THROTTLE)
  streets(@Query() query: StreetsQueryDto) {
    return this.catastro.streets(query.province, query.municipality, query.q);
  }
}

@Controller('estates/:estateId/catastro')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateCatastroController {
  constructor(private readonly catastro: CatastroService) {}

  /** Lee el Catastro y devuelve las unidades SIN escribir nada. */
  @Post('lookup')
  @Throttle(CATASTRO_THROTTLE)
  lookup(
    @Param('estateId') estateId: string,
    @Body() dto: LookupCatastroDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.catastro.lookup(estateId, dto, user);
  }

  /** Crea las unidades ya revisadas por el gestor (idempotente por referencia). */
  @Post('import')
  import(
    @Param('estateId') estateId: string,
    @Body() dto: ImportCatastroDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.catastro.importUnits(estateId, dto, user);
  }
}
