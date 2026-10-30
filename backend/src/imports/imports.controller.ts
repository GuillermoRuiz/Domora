import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ImportSourcePlatform } from '../prisma/client';
import { ImportsService, IMPORTS_MAX_FILE_BYTES, type UploadedMulterFile } from './imports.service';
import { CreateImportBatchDto } from './dto/create-import-batch.dto';
import { ValidateImportDto } from './dto/validate-import.dto';
import type { ImportEntityType } from './presets/gesfincas-net.presets';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Autoservicio de rol B únicamente (decisión ya confirmada del plan de
 * importación) — sin entrada para rol A. Fase 2: subir → parsear → mapear →
 * validar → confirmar (Property/ExternalOwner, sub-fase A del plan) →
 * deshacer. El histórico contable (sub-fase B) queda para una fase
 * posterior.
 */
@Controller('estates/:estateId/imports')
@UseGuards(EstateScopeGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  @Roles('B')
  list(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.importsService.listBatches(estateId, user);
  }

  @Get('presets')
  @Roles('B')
  presets(
    @Query('platform') platform: ImportSourcePlatform,
    @Query('entityType') entityType: ImportEntityType,
    @Query('headers') headers?: string,
  ) {
    return this.importsService.getPresets(
      platform,
      entityType,
      headers ? headers.split(',') : undefined,
    );
  }

  @Get(':id')
  @Roles('B')
  get(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.getBatch(estateId, id, user);
  }

  @Post()
  @Roles('B')
  @UseInterceptors(
    FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: IMPORTS_MAX_FILE_BYTES } }),
  )
  create(
    @Param('estateId') estateId: string,
    @UploadedFile() file: UploadedMulterFile,
    @Body() dto: CreateImportBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.createBatch(estateId, dto, file, user);
  }

  @Post(':id/parse')
  @Roles('B')
  parse(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.parse(estateId, id, user);
  }

  @Post(':id/validate')
  @Roles('B')
  validate(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @Body() dto: ValidateImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.validate(estateId, id, dto, user);
  }

  @Post(':id/commit')
  @Roles('B')
  commit(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.commit(estateId, id, user);
  }

  @Post(':id/rollback')
  @Roles('B')
  rollback(
    @Param('estateId') estateId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.rollback(estateId, id, user);
  }
}
