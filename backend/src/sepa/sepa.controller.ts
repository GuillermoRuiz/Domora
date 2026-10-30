import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MandatesService } from './mandates.service';
import { RemesasService } from './remesas.service';
import { CreateRemesaDto } from './dto/create-remesa.dto';
import { CollectRemesaDto } from './dto/collect-remesa.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

@Controller('properties/:propertyId/mandates')
@Roles('A', 'B')
export class PropertyMandatesController {
  constructor(private readonly mandatesService: MandatesService) {}

  @Get()
  list(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('all') all?: string,
  ) {
    return this.mandatesService.listByProperty(
      propertyId,
      user,
      all !== 'true',
    );
  }
}

@Controller('estates/:estateId/remesas')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateRemesasController {
  constructor(private readonly remesasService: RemesasService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remesasService.listByEstate(estateId, user);
  }

  @Get('candidates')
  candidates(
    @Param('estateId') estateId: string,
    @Query('periodKey') periodKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remesasService.listCandidates(estateId, periodKey, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateRemesaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remesasService.create(estateId, dto, user);
  }
}

@Controller('remesas')
@Roles('A', 'B')
export class RemesasController {
  constructor(private readonly remesasService: RemesasService) {}

  @Get(':id/file')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async file(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const { xml } = await this.remesasService.getFile(id, user);
    return xml;
  }

  /** El banco abonó la remesa: se contabiliza el cobro de todas sus líneas. */
  @Post(':id/collect')
  collect(
    @Param('id') id: string,
    @Body() dto: CollectRemesaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remesasService.collect(id, dto, user);
  }

  /** Anula una remesa no cobrada: sus recibos quedan libres. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.remesasService.cancel(id, user);
  }

  @Get(':id/lines')
  lines(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.remesasService.listLines(id, user);
  }
}
