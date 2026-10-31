import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { DebtorsService } from './debtors.service';
import { DebtCertificatePdfService } from './debt-certificate-pdf.service';
import { CreateDebtorActionDto } from './dto/create-debtor-action.dto';
import { CreatePaymentAgreementDto } from './dto/create-payment-agreement.dto';
import {
  CancelAgreementDto,
  MarkInstallmentPaidDto,
  RemesaLineReturnDto,
} from './dto/misc.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

@Controller('debtors')
@Roles('A', 'B')
export class DebtorsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.debtorsService.listDebtors(user);
  }

  @Get(':debtorId/actions')
  listActions(
    @Param('debtorId') debtorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.listActions(debtorId, user);
  }

  @Post(':debtorId/actions')
  addAction(
    @Param('debtorId') debtorId: string,
    @Body() dto: CreateDebtorActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.addAction(debtorId, dto, user);
  }

  @Get(':debtorId/agreement')
  findActiveAgreement(
    @Param('debtorId') debtorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.findActiveAgreement(debtorId, user);
  }

  @Post(':debtorId/agreement')
  createAgreement(
    @Param('debtorId') debtorId: string,
    @Body() dto: CreatePaymentAgreementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.createAgreement(debtorId, dto, user);
  }
}

@Controller('properties/:propertyId')
export class DebtCertificateController {
  constructor(
    private readonly debtorsService: DebtorsService,
    private readonly certificatePdf: DebtCertificatePdfService,
  ) {}

  /** Para la pantalla de gestión — nunca al rol C: expone ids internos y el acuerdo de pago completo. */
  @Get('debt-certificate')
  @Roles('A', 'B')
  issue(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.debtCertificate(propertyId, user);
  }

  /**
   * Descarga del propietario (rol C incluido, solo de SU propia propiedad
   * — la comprobación real vive en `DebtorsService.debtCertificate()`, vía
   * `PropertyAccessService`). PDF en borrador (ADR D22): sin firmar, no
   * tiene validez legal como certificado.
   */
  @Get('debt-certificate.pdf')
  @Roles('A', 'B', 'C')
  async pdf(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const cert = await this.debtorsService.debtCertificate(propertyId, user);
    const content = await this.certificatePdf.render(cert);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="certificado-deuda-${propertyId}.pdf"`,
    );
    res.send(content);
  }
}

@Controller('estates/:estateId/debtors')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateDebtorsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.listDebtorsByEstate(estateId, user);
  }

  /** Saldo de TODOS los vecinos de la finca, no solo los ya gestionados como morosos — ver `DebtorsService.computeBalances`. */
  @Get('balances')
  balances(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.computeBalances(estateId, user);
  }

  /** `.xlsx` generado al vuelo — no se persiste (ver DebtorBalancesExcelService). */
  @Get('balances.xlsx')
  async balancesExport(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { fileName, content } =
      await this.debtorsService.generateBalancesExcelFile(estateId, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(content);
  }
}

@Controller('payment-agreements')
@Roles('A', 'B')
export class PaymentAgreementsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Get(':agreementId/installments')
  listInstallments(
    @Param('agreementId') agreementId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.listInstallments(agreementId, user);
  }

  @Post(':agreementId/cancel')
  cancel(
    @Param('agreementId') agreementId: string,
    @Body() dto: CancelAgreementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.cancelAgreement(
      agreementId,
      dto.cancelledReason,
      user,
    );
  }
}

@Controller('payment-installments')
@Roles('A', 'B')
export class PaymentInstallmentsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Patch(':installmentId/paid')
  markPaid(
    @Param('installmentId') installmentId: string,
    @Body() dto: MarkInstallmentPaidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.markInstallmentPaid(installmentId, dto, user);
  }
}

@Controller('remesa-lines')
@Roles('A', 'B')
export class RemesaLinesController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Patch(':lineId/return')
  markReturned(
    @Param('lineId') lineId: string,
    @Body() dto: RemesaLineReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debtorsService.returnRemesaLine(lineId, dto, user);
  }
}
