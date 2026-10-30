import { Module } from '@nestjs/common';
import {
  DebtCertificateController,
  DebtorsController,
  EstateDebtorsController,
  PaymentAgreementsController,
  PaymentInstallmentsController,
  RemesaLinesController,
} from './debtors.controller';
import { DebtorsService } from './debtors.service';
import { DebtorBalancesExcelService } from './debtor-balances-excel.service';
import { DebtCertificatePdfService } from './debt-certificate-pdf.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [EstateAccessModule, LedgerModule],
  controllers: [
    DebtCertificateController,
    DebtorsController,
    EstateDebtorsController,
    PaymentAgreementsController,
    PaymentInstallmentsController,
    RemesaLinesController,
  ],
  providers: [
    DebtorsService,
    DebtorBalancesExcelService,
    DebtCertificatePdfService,
  ],
  exports: [DebtorsService],
})
export class DebtorsModule {}
