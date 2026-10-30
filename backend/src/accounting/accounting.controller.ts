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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccountingService } from './accounting.service';
import { GenerateReceiptsDto } from './dto/generate-receipts.dto';
import { CancelReceiptDto, UpdateReceiptDto } from './dto/update-receipt.dto';
import { CreateManualReceiptDto } from './dto/create-manual-receipt.dto';
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

/**
 * Resumen y periodos contables de la finca: solo gestión. El propietario
 * ve lo suyo por `users/:userId/receipts`, nunca las cuentas de la finca.
 */
@Controller('estates/:estateId/accounting')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateAccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('summary')
  summary(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.summary(estateId, user);
  }

  @Get('periods')
  listPeriods(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.listPeriods(estateId, user);
  }
}

@Controller('estates/:estateId/receipts')
@UseGuards(EstateScopeGuard)
export class EstateReceiptsController {
  constructor(private readonly accountingService: AccountingService) {}

  /**
   * Solo gestión: el listado lleva nombre, NIF e IBAN enmascarado de todos
   * los vecinos. Antes no tenía @Roles y un propietario podía ver la deuda
   * y el NIF de los demás.
   */
  @Get()
  @Roles('A', 'B')
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('periodKey') periodKey?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.accountingService.listReceipts(estateId, user, {
      periodKey,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('generate')
  @Roles('A', 'B')
  generate(
    @Param('estateId') estateId: string,
    @Body() dto: GenerateReceiptsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.generateReceipts(estateId, dto, user);
  }

  @Post()
  @Roles('A', 'B')
  createManual(
    @Param('estateId') estateId: string,
    @Body() dto: CreateManualReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.createManualReceipt(estateId, dto, user);
  }
}

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly accountingService: AccountingService) {}

  @Patch(':id')
  @Roles('A', 'B')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.updateReceipt(id, dto, user);
  }

  /** Anula un recibo emitido por error: contraasiento de su emisión. */
  @Post(':id/cancel')
  @Roles('A', 'B')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.cancelReceipt(id, dto.reason, user);
  }

  /** Sube el justificante de pago — solo el propietario del recibo (rol C) o gestión. */
  @Post(':id/payment-proof')
  @Roles('A', 'B', 'C')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: StorageService.MAX_SIZE_BYTES },
    }),
  )
  uploadPaymentProof(
    @Param('id') id: string,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.uploadPaymentProof(id, file, user);
  }

  /** El servicio comprueba que el rol C sea el propietario del recibo. */
  @Get(':id/payment-proof/file')
  @Roles('A', 'B', 'C')
  async downloadPaymentProof(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } =
      await this.accountingService.getPaymentProofContent(id, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }
}

@Controller('users/:userId/receipts')
export class UserReceiptsController {
  constructor(private readonly accountingService: AccountingService) {}

  /** El servicio comprueba que el rol C solo pida sus propios recibos. */
  @Get()
  @Roles('A', 'B', 'C')
  listByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountingService.listReceiptsForUser(userId, user);
  }
}
