import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { StorageService } from '../../files/storage.service';
import { ActaService, type UploadedActaFile } from './acta.service';
import {
  GenerateActaDto,
  SaveActaEditsDto,
  UploadActaDto,
} from './dto/acta.dto';

/**
 * Acta canónica de una junta (borrador reproducible, versionado y con PDF). Las rutas viven bajo
 * `/meetings/:id/acta…` junto a las heredadas (`acta/sign`, `acta/send`, `acta.docx`, `acta-versions`),
 * que no cambian. Decisiones de diseño:
 *  - GET  acta                      → versión actual (o `null`) + estado del acta heredada. No versiona.
 *  - GET  acta/validation           → errores, avisos y datos que faltan; alimenta el paso de preparación.
 *  - POST acta/generate             → confirma los datos de la reunión y crea el borrador (idempotente:
 *                                     si ya existe, lo devuelve; `refresh` vuelve a congelar los datos).
 *  - PATCH acta                     → guarda ediciones de los bloques redactables como una versión nueva.
 *  - POST acta/regenerate-narrative → vuelve a redactar las notas sin tocar los datos congelados.
 *  - POST acta/sync-notes           → recoge las notas nuevas sin pisar lo editado a mano en el visor.
 *  - POST acta/prepare-for-signature→ marca la versión lista para firma y guarda su PDF y su huella.
 *  - POST acta/upload               → sube un acta ya hecha (PDF/DOCX), ya firmada o pendiente de firma.
 *  - GET  acta/file                 → el archivo subido como acta.
 *  - GET  acta.pdf                  → PDF de la versión actual, renderizado desde su modelo guardado.
 */
@Controller('meetings')
export class ActaController {
  constructor(private readonly acta: ActaService) {}

  @Get(':id/acta')
  @Roles('A', 'B')
  current(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.acta.getCurrent(id, user);
  }

  @Get(':id/acta/versions')
  @Roles('A', 'B')
  versions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.acta.listVersions(id, user);
  }

  @Get(':id/acta/versions/:versionId')
  @Roles('A', 'B')
  version(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.getVersion(id, versionId, user);
  }

  @Get(':id/acta/validation')
  @Roles('A', 'B')
  validation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.acta.validate(id, user);
  }

  @Post(':id/acta/generate')
  @Roles('A', 'B')
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateActaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.generate(id, dto, user);
  }

  @Patch(':id/acta')
  @Roles('A', 'B')
  saveEdits(
    @Param('id') id: string,
    @Body() dto: SaveActaEditsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.saveEdits(id, dto, user);
  }

  @Post(':id/acta/regenerate-narrative')
  @Roles('A', 'B')
  regenerateNarrative(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.regenerateNarrative(id, user);
  }

  @Post(':id/acta/sync-notes')
  @Roles('A', 'B')
  syncNotes(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.acta.syncNotes(id, user);
  }

  @Post(':id/acta/upload')
  @Roles('A', 'B')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES, files: 1 },
    }),
  )
  upload(
    @Param('id') id: string,
    @UploadedFile() file: UploadedActaFile,
    @Body() dto: UploadActaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.uploadExisting(
      id,
      file,
      dto.alreadySigned === 'true',
      user,
    );
  }

  @Get(':id/acta/file')
  @Roles('A', 'B')
  async uploadedFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } = await this.acta.downloadUpload(
      id,
      user,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Post(':id/acta/prepare-for-signature')
  @Roles('A', 'B')
  prepareForSignature(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.acta.prepareForSignature(id, user);
  }

  @Get(':id/acta.pdf')
  @Roles('A', 'B')
  async pdf(
    @Param('id') id: string,
    @Query('version') version: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, filename } = await this.acta.getPdf(id, user, version);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(content);
  }
}
