import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { StorageService } from '../files/storage.service';
import { LibraryService, type UploadedFile as Upload } from './library.service';
import {
  CreateFolderDto,
  LibraryQueryDto,
  ReviewDocumentsDto,
  UpdateDocumentDto,
  UpdateFolderDto,
  UploadDocumentDto,
} from './dto/library.dto';

/** Estate document library. Reads: A/B/C (each sees what the visibility rule allows). Writes: A/B. */
@Controller('estates/:estateId')
@UseGuards(EstateScopeGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('library')
  list(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Query() query: LibraryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.list(estateId, user, query);
  }

  /** Uploads the file and creates the document in one step (same URL as before the library). */
  @Post('documents/upload')
  @Roles('A', 'B')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  upload(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @UploadedFile() file: Upload,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.upload(estateId, file, dto, user);
  }

  @Post('library/folders')
  @Roles('A', 'B')
  createFolder(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.createFolder(estateId, dto, user);
  }

  @Patch('library/folders/:folderId')
  @Roles('A', 'B')
  updateFolder(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: UpdateFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.updateFolder(estateId, folderId, dto, user);
  }

  @Delete('library/folders/:folderId')
  @Roles('A', 'B')
  deleteFolder(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.deleteFolder(estateId, folderId, user);
  }

  @Patch('library/documents/:documentId')
  @Roles('A', 'B')
  updateDocument(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.updateDocument(estateId, documentId, dto, user);
  }

  @Delete('library/documents/:documentId')
  @Roles('A', 'B')
  trash(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.trash(estateId, documentId, user);
  }

  @Post('library/documents/:documentId/restore')
  @Roles('A', 'B')
  restore(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.restore(estateId, documentId, user);
  }

  @Post('library/review')
  @Roles('A', 'B')
  review(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Body() dto: ReviewDocumentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.markReviewed(
      estateId,
      dto.documentIds,
      !!dto.all,
      user,
    );
  }
}
