import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  isUUID,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { AuditService } from '../gdpr/audit.service';
import { LibraryService } from '../documents/library.service';
import { documentMime } from '../documents/file-signature';

/** Why the file is fetched: the owner's viewer asks for `view`, the «Descargar» button for `download` (G14). */
const FILE_PURPOSES = ['view', 'download'] as const;
type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * RFC 6266 / RFC 5987 Content-Disposition: an ASCII fallback for old clients plus the exact
 * UTF-8 name. A title without extension takes the one of the stored file («Póliza» → «Póliza.pdf»).
 */
export function contentDisposition(
  title: string,
  s3Key: string | null,
): string {
  const clean = title.replace(/[\r\n\t]+/g, ' ').trim() || 'documento';
  const keyExtension = /\.([A-Za-z0-9]{1,8})$/.exec(s3Key ?? '')?.[1];
  const name =
    /\.[A-Za-z0-9]{1,8}$/.test(clean) || !keyExtension
      ? clean
      : `${clean}.${keyExtension.toLowerCase()}`;
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('documents')
export class DocumentFilesController {
  private readonly logger = new Logger(DocumentFilesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly currentAuthorization: RagAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Descarga autorizada por la misma regla de visibilidad que el listado.
   * «No existe», «es de otra comunidad», «no lo puedes ver» y «no tiene fichero»
   * responden EXACTAMENTE igual (404): así nadie puede saber si un documento
   * ajeno existe probando identificadores.
   */
  @Get(':id/file')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('purpose') purpose?: string,
  ) {
    if (!isUUID(id))
      throw new BadRequestException('Identificador de documento no válido.');
    if (
      purpose !== undefined &&
      !(FILE_PURPOSES as readonly string[]).includes(purpose)
    ) {
      throw new BadRequestException(
        'Uso del fichero no válido (view o download).',
      );
    }
    const action: FilePurpose =
      (purpose as FilePurpose | undefined) ?? 'download';
    const notFound = () => new NotFoundException('Documento no encontrado.');
    const document = await this.prisma.document.findFirst({ where: { id } });
    if (!document || !document.s3Key || !document.estateId) throw notFound();
    // The list of authorized ids follows the library visibility rule (and excludes the trash).
    let authorized: string[];
    try {
      authorized = (
        await this.currentAuthorization.resolve(user, document.estateId)
      ).authorized_document_ids;
    } catch (error) {
      // No access to that community: same answer as a document that does not exist.
      if (error instanceof ForbiddenException) throw notFound();
      throw error;
    }
    if (!authorized.includes(document.id)) throw notFound();
    if (document.source === 'generated') {
      // Generated documents point at the file of their origin (e.g. the signed acta), never anywhere else.
      const prefix = LibraryService.generatedKeyPrefix(document.sourceRef);
      if (!prefix || !document.s3Key.startsWith(prefix))
        throw new ForbiddenException('Fichero no permitido.');
    } else {
      this.storage.assertDocumentKey(document.s3Key, document.estateId);
    }
    let content: Buffer;
    try {
      content = await this.storage.get(document.s3Key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Only an authorized user gets here; the storage detail stays in the server log.
        this.logger.warn(
          `Document ${document.id}: file ${document.s3Key} is missing from storage.`,
        );
        throw new NotFoundException(
          'El fichero de este documento no está disponible.',
        );
      }
      throw error;
    }
    await this.audit.logAccess(
      user,
      'document',
      action,
      document.id,
      document.title,
    );
    res.setHeader(
      'Content-Disposition',
      contentDisposition(document.title, document.s3Key),
    );
    // Documents carry personal data: no browser, proxy or service worker keeps a copy (G11).
    res.setHeader('Cache-Control', 'private, no-store');
    // Real type when known, so the browser can preview PDFs and images; nosniff keeps it from guessing.
    res.setHeader(
      'Content-Type',
      documentMime(document) ?? 'application/octet-stream',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(content);
  }
}

@Controller('issues/:issueId/photos')
export class IssuePhotosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly estateAccess: EstateAccessService,
    private readonly propertyAccess: PropertyAccessService,
  ) {}

  private async assertIssueAccess(
    issueId: string,
    user: AuthenticatedUser,
    options: { write?: boolean } = {},
  ) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
    });
    if (!issue) {
      throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
    }
    // Las fotos las ve cualquier miembro ACTIVO de la comunidad (comprobado en la base de datos) y solo las sube quien reportó la
    // incidencia. Quien no es miembro recibe lo mismo que si no existiera.
    if (user.role === 'C') {
      if (!(await this.propertyAccess.isActiveMember(issue.estateId, user)))
        throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
      if (
        options.write &&
        (await this.prisma.issueReport.count({
          where: { issueId, reporterUserId: user.id },
        })) === 0
      )
        throw new ForbiddenException(
          'Solo quien reportó esta incidencia puede añadir fotos.',
        );
      return issue;
    }
    this.estateAccess.assertAccess(issue.estateId, user);
    return issue;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  async upload(
    @Param('issueId') issueId: string,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertIssueAccess(issueId, user, { write: true });
    if (!file) {
      throw new NotFoundException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    // Photos and documents (PDF) can be attached to an issue.
    if (
      !file.mimetype.startsWith('image/') &&
      file.mimetype !== 'application/pdf'
    ) {
      throw new BadRequestException(
        'Los adjuntos de una incidencia deben ser imágenes o PDF.',
      );
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `issues/${issueId}`,
      file.originalname,
      file.buffer,
    );
    return this.prisma.issuePhoto.create({
      data: {
        issueId,
        s3Key,
        url: null,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
  }

  @Get(':photoId/file')
  async download(
    @Param('issueId') issueId: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.assertIssueAccess(issueId, user);
    const photo = await this.prisma.issuePhoto.findFirst({
      where: { id: photoId, issueId },
    });
    if (!photo) {
      throw new NotFoundException('Foto no encontrada.');
    }
    const content = await this.storage.get(photo.s3Key);
    // Photos and PDFs: serve what was uploaded (older rows have no type and were always images).
    res.setHeader('Content-Type', photo.mimeType ?? 'image/jpeg');
    res.send(content);
  }
}
