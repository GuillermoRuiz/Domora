import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import { StorageService } from '../../files/storage.service';
import {
  JournalBookService,
  type UploadedEntryFile,
} from './journal-book.service';
import {
  CreateManualEntryDto,
  ListJournalQuery,
  QuickEntryDto,
  ReverseEntryDto,
  TransferDto,
} from './journal-book.dto';

/** Libro diario y tesorería de la finca: solo gestión. */
@Controller('estates/:estateId')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateJournalController {
  constructor(private readonly service: JournalBookService) {}

  @Get('journal')
  list(
    @Param('estateId') estateId: string,
    @Query() query: ListJournalQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(estateId, query, user);
  }

  @Post('journal')
  createManual(
    @Param('estateId') estateId: string,
    @Body() dto: CreateManualEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createManual(estateId, dto, user);
  }

  /** Cobro o pago suelto contra una cuenta de ingreso o gasto. */
  @Post('treasury/entries')
  quickEntry(
    @Param('estateId') estateId: string,
    @Body() dto: QuickEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.quickEntry(estateId, dto, user);
  }

  /** Traspaso entre cuentas bancarias o la caja. */
  @Post('treasury/transfers')
  transfer(
    @Param('estateId') estateId: string,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.transfer(estateId, dto, user);
  }
}

/** Un asiento concreto: detalle, anulación y adjuntos. Solo gestión. */
@Controller('journal')
@Roles('A', 'B')
export class JournalEntryController {
  constructor(private readonly service: JournalBookService) {}

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reverse(id, dto, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedEntryFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.attach(id, file, user);
  }

  @Get(':id/attachments/:attachmentId/file')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } =
      await this.service.attachmentContent(id, attachmentId, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }
}
