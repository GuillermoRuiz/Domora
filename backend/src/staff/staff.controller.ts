import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { StaffService } from './staff.service';
import { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import { UpdateStaffMemberDto } from './dto/update-staff-member.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { StorageService } from '../files/storage.service';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Personal contratado por la finca (portero, seguridad, socorrista...) —
// relación laboral, no mercantil (a diferencia de Supplier). La gestión
// completa es interna del administrador, nunca visible para rol C; el
// directorio de contacto (más abajo) es la única excepción deliberada.
@Controller('estates/:estateId/staff')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.listStaff(estateId, user);
  }

  /**
   * Directorio de contacto para el propietario (rol C): solo personal
   * activo, proyección restringida a lo necesario para contactarlo. Pisa el
   * @Roles('A','B') de la clase — RolesGuard prioriza metadata de método
   * sobre la de clase (reflector.getAllAndOverride).
   */
  @Roles('A', 'B', 'C')
  @Get('directory')
  directory(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.listDirectory(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateStaffMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.createStaffMember(estateId, dto, user);
  }

  @Patch(':staffId')
  update(
    @Param('estateId') estateId: string,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.updateStaffMember(estateId, staffId, dto, user);
  }

  @Get(':staffId/documents')
  listDocuments(
    @Param('estateId') estateId: string,
    @Param('staffId') staffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.listDocuments(estateId, staffId, user);
  }

  @Post(':staffId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  uploadDocument(
    @Param('estateId') estateId: string,
    @Param('staffId') staffId: string,
    @Body('title') title: string,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.uploadDocument(
      estateId,
      staffId,
      title,
      file,
      user,
    );
  }

  @Get(':staffId/documents/:docId/file')
  async downloadDocument(
    @Param('estateId') estateId: string,
    @Param('staffId') staffId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } =
      await this.staffService.getDocumentFileContent(
        estateId,
        staffId,
        docId,
        user,
      );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Delete(':staffId/documents/:docId')
  deleteDocument(
    @Param('estateId') estateId: string,
    @Param('staffId') staffId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.deleteDocument(estateId, staffId, docId, user);
  }
}
