import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import {
  RETURN_FILE_MAX_BYTES,
  ReturnFilesService,
  type UploadedReturnFile,
} from './return-files.service';

export class ApplyReturnFileDto {
  /** Repercutir las comisiones al propietario. Sin indicarlo, lo que diga la configuración contable. */
  @IsOptional()
  @IsBoolean()
  rechargeFee?: boolean;
}

/** Ficheros de devoluciones del banco de una finca: solo gestión. */
@Controller('estates/:estateId/return-files')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateReturnFilesController {
  constructor(private readonly service: ReturnFilesService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(estateId, user);
  }

  /** Sube un pain.002 o camt.054: se guarda con sus partidas emparejadas, sin contabilizar nada. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: RETURN_FILE_MAX_BYTES } }),
  )
  upload(
    @Param('estateId') estateId: string,
    @UploadedFile() file: UploadedReturnFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.upload(estateId, file, user);
  }
}

/** Revisar y aplicar un fichero de devoluciones: solo gestión. */
@Controller('return-files')
@Roles('A', 'B')
export class ReturnFilesController {
  constructor(private readonly service: ReturnFilesService) {}

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }

  /** Contabiliza las devoluciones emparejadas. Se puede repetir sin duplicar nada. */
  @Post(':id/apply')
  @HttpCode(200)
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyReturnFileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.apply(id, dto, user);
  }
}
