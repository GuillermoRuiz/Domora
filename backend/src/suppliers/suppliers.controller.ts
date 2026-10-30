import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { SupplierDocumentType } from '../prisma/client';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import {
  CancelSupplierInvoiceDto,
  UpdateSupplierInvoiceDto,
} from './dto/update-supplier-invoice.dto';
import {
  CreateSupplierPaymentDto,
  UndoSupplierPaymentDto,
} from './dto/supplier-payment.dto';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierVisitsService } from './supplier-visits.service';
import { SupplierOverviewService } from './supplier-overview.service';
import {
  CloseSupplierVisitDto,
  CreateSupplierVisitDto,
  UpdateSupplierVisitDto,
} from './dto/supplier-visit.dto';
import { CreateSupplierContractDto } from './dto/create-supplier-contract.dto';
import { RenewSupplierContractDto } from './dto/renew-supplier-contract.dto';
import {
  CancelSupplierContractDto,
  UpdateSupplierContractDto,
} from './dto/update-supplier-contract.dto';
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

// Proveedores (relación mercantil, no laboral — a diferencia de Staff) —
// gestión interna del administrador, nunca visible para rol C. Antes vivía
// dentro de debtors/ solo porque compartía el mismo guard de roles; sin
// relación conceptual real con morosidad, se separa a su propio módulo.
@Controller('estates/:estateId/suppliers')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly invoices: SupplierInvoicesService,
    private readonly visits: SupplierVisitsService,
    private readonly overview: SupplierOverviewService,
  ) {}

  /** Datos del panel de Proveedores: KPIs, una fila por proveedor y últimas intervenciones. */
  @Get('overview')
  getOverview(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.overview.getOverview(estateId, user);
  }

  @Get()
  list(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.listSuppliers(estateId, user);
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.createSupplier(estateId, dto, user);
  }

  @Patch(':supplierId')
  update(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.updateSupplier(estateId, supplierId, dto, user);
  }

  @Get(':supplierId/performance')
  performance(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.getSupplierPerformance(estateId, supplierId, user);
  }

  // ── Visits ───────────────────────────────────────────────────────────────

  @Get(':supplierId/visits')
  listVisits(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.list(estateId, supplierId, user);
  }

  @Post(':supplierId/visits')
  createVisit(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.create(estateId, supplierId, dto, user);
  }

  @Patch(':supplierId/visits/:visitId')
  updateVisit(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('visitId') visitId: string,
    @Body() dto: UpdateSupplierVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.update(estateId, supplierId, visitId, dto, user);
  }

  @Post(':supplierId/visits/:visitId/complete')
  @HttpCode(200)
  completeVisit(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('visitId') visitId: string,
    @Body() dto: CloseSupplierVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.complete(estateId, supplierId, visitId, dto, user);
  }

  @Post(':supplierId/visits/:visitId/cancel')
  @HttpCode(200)
  cancelVisit(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('visitId') visitId: string,
    @Body() dto: CloseSupplierVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.cancel(estateId, supplierId, visitId, dto, user);
  }

  // ── Invoices ─────────────────────────────────────────────────────────────

  @Get(':supplierId/invoices')
  listInvoices(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.listForSupplier(estateId, supplierId, user);
  }

  @Post(':supplierId/invoices')
  createInvoice(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.create(estateId, supplierId, dto, user);
  }

  @Patch(':supplierId/invoices/:invoiceId')
  updateInvoice(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: UpdateSupplierInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.updateDueDate(estateId, supplierId, invoiceId, dto, user);
  }

  /** Anula una factura sin pagos: contraasiento de su registro. */
  @Post(':supplierId/invoices/:invoiceId/cancel')
  cancelInvoice(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CancelSupplierInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.cancel(estateId, supplierId, invoiceId, dto, user);
  }

  /** Mayor del proveedor: sus apuntes en la 400/410 y lo que se le debe. */
  @Get(':supplierId/ledger')
  ledger(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.ledger(estateId, supplierId, user);
  }

  @Post(':supplierId/invoices/:invoiceId/file')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: StorageService.MAX_SIZE_BYTES } }))
  uploadInvoiceFile(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('invoiceId') invoiceId: string,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.uploadInvoiceFile(estateId, supplierId, invoiceId, file, user);
  }

  @Get(':supplierId/invoices/:invoiceId/file')
  async downloadInvoiceFile(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } = await this.suppliersService.getInvoiceFileContent(
      estateId,
      supplierId,
      invoiceId,
      user,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  // ── Contratos ────────────────────────────────────────────────────────────

  @Get(':supplierId/contracts')
  listContracts(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.listSupplierContracts(estateId, supplierId, user);
  }

  @Post(':supplierId/contracts')
  createContract(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.createSupplierContract(estateId, supplierId, dto, user);
  }

  @Patch(':supplierId/contracts/:contractId')
  updateContract(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('contractId') contractId: string,
    @Body() dto: UpdateSupplierContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.updateSupplierContract(estateId, supplierId, contractId, dto, user);
  }

  @Post(':supplierId/contracts/:contractId/cancel')
  cancelContract(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('contractId') contractId: string,
    @Body() dto: CancelSupplierContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.cancelSupplierContract(estateId, supplierId, contractId, dto, user);
  }

  /** Renueva el contrato (nuevo vencimiento) y deja constancia en el histórico de renovaciones. */
  @Post(':supplierId/contracts/:contractId/renew')
  renewContract(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('contractId') contractId: string,
    @Body() dto: RenewSupplierContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.renewSupplierContract(estateId, supplierId, contractId, dto, user);
  }

  // ── Documentos ───────────────────────────────────────────────────────────

  @Get(':supplierId/documents')
  listDocuments(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.listSupplierDocuments(estateId, supplierId, user);
  }

  @Post(':supplierId/documents')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: StorageService.MAX_SIZE_BYTES } }))
  uploadDocument(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Body('title') title: string,
    @Body('documentType') documentType: SupplierDocumentType,
    @Body('expiresAt') expiresAt: string | undefined,
    @Body('contractId') contractId: string | undefined,
    @UploadedFile() file: UploadedMulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.uploadSupplierDocument(
      estateId,
      supplierId,
      { title, documentType, expiresAt: expiresAt || undefined, contractId: contractId || undefined },
      file,
      user,
    );
  }

  @Get(':supplierId/documents/:docId/file')
  async downloadDocument(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { content, fileName, mimeType } = await this.suppliersService.getSupplierDocumentFileContent(
      estateId,
      supplierId,
      docId,
      user,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Delete(':supplierId/documents/:docId')
  deleteDocument(
    @Param('estateId') estateId: string,
    @Param('supplierId') supplierId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.deleteSupplierDocument(estateId, supplierId, docId, user);
  }
}

/** Facturas pendientes y pagos a proveedores de la finca: solo gestión. */
@Controller('estates/:estateId')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateSupplierPaymentsController {
  constructor(
    private readonly invoices: SupplierInvoicesService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** Contratos con proveedores de toda la finca, con estado y días hasta el vencimiento. */
  @Get('contracts')
  listContracts(@Param('estateId') estateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliers.listEstateContracts(estateId, user);
  }

  /** Últimas renovaciones de contratos de la finca (la más reciente primero). */
  @Get('contracts/renewals')
  listRenewals(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.suppliers.listEstateRenewals(estateId, user, limit);
  }

  /** Facturas de proveedores de la finca: pendientes de pago, o todas con `all=true`. */
  @Get('supplier-invoices')
  listInvoices(
    @Param('estateId') estateId: string,
    @Query('all') all: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.listForEstate(estateId, { onlyOpen: all !== 'true' }, user);
  }

  @Get('supplier-payments')
  listPayments(
    @Param('estateId') estateId: string,
    @Query('supplierId') supplierId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.listPayments(estateId, { supplierId }, user);
  }

  @Post('supplier-payments')
  pay(
    @Param('estateId') estateId: string,
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.pay(estateId, dto, user);
  }
}

/** Deshacer un pago a proveedor: solo gestión. */
@Controller('supplier-payments')
@Roles('A', 'B')
export class SupplierPaymentsController {
  constructor(private readonly invoices: SupplierInvoicesService) {}

  @Post(':id/undo')
  @HttpCode(200)
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoSupplierPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.undoPayment(id, dto, user);
  }
}
