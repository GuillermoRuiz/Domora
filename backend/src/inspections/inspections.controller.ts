import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InspectionsService } from './inspections.service';
import { StorageService } from '../files/storage.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { CreateInspectionResultDto } from './dto/create-inspection-result.dto';
import { CreateCorrectiveActionDto } from './dto/create-corrective-action.dto';
import { UpdateCorrectiveActionDto } from './dto/update-corrective-action.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer) — mismo tipo que en files.controller.ts. */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('estates/:estateId/inspections')
@UseGuards(EstateScopeGuard)
export class EstateInspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.inspectionsService.listByEstate(estateId, user, {
      status,
      search,
    });
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateInspectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.create(estateId, dto, user);
  }
}

@Controller('inspections')
export class InspectionsController {
  constructor(
    private readonly inspectionsService: InspectionsService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inspectionsService.findById(id, user);
  }

  @Patch(':id')
  @Roles('A', 'B')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInspectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('A', 'B')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inspectionsService.remove(id, user);
  }

  @Post(':id/results')
  @Roles('A', 'B')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  async addResult(
    @Param('id') id: string,
    @Body() dto: CreateInspectionResultDto,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    let certificateKey: string | null = null;
    if (file) {
      this.storage.assertAllowed(file.mimetype, file.size);
      certificateKey = await this.storage.put(
        `inspections/${id}`,
        file.originalname,
        file.buffer,
      );
    }
    return this.inspectionsService.addResult(id, dto, certificateKey, user);
  }

  @Get(':id/results/:resultId/certificate')
  async downloadCertificate(
    @Param('id') id: string,
    @Param('resultId') resultId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const content = await this.inspectionsService.getResultCertificate(
      id,
      resultId,
      user,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);
  }

  @Post(':id/corrective-actions')
  @Roles('A', 'B')
  addCorrectiveAction(
    @Param('id') id: string,
    @Body() dto: CreateCorrectiveActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.addCorrectiveAction(id, dto, user);
  }

  @Patch('corrective-actions/:actionId')
  @Roles('A', 'B')
  updateCorrectiveAction(
    @Param('actionId') actionId: string,
    @Body() dto: UpdateCorrectiveActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.updateCorrectiveAction(
      actionId,
      dto,
      user,
    );
  }
}
