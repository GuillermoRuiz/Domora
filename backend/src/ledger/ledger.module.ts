import { Module } from '@nestjs/common';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { CryptoModule } from '../sepa/crypto.module';
import { JournalService } from './journal/journal.service';
import { LedgerQueryService } from './ledger-query.service';
import { InvariantsService } from './invariants.service';
import { ChartAccountsService } from './chart/chart-accounts.service';
import { BankAccountsService } from './banks/bank-accounts.service';
import { AccountingSettingsService } from './settings/accounting-settings.service';
import { ReceiptPostingService } from './posting/receipt-posting.service';
import { CollectionPostingService } from './posting/collection-posting.service';
import { SupplierPostingService } from './posting/supplier-posting.service';
import { PayrollPostingService } from './posting/payroll-posting.service';
import { TaxSettlementPostingService } from './posting/tax-settlement-posting.service';
import { TreasuryPostingService } from './posting/treasury-posting.service';
import { JournalBookService } from './journal-book/journal-book.service';
import {
  EstateJournalController,
  JournalEntryController,
} from './journal-book/journal-book.controller';
import { FilesModule } from '../files/files.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { BudgetService } from './budget/budget.service';
import {
  EstateBudgetController,
  EstateCostCentreBudgetController,
} from './budget/budget.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import {
  BankReconciliationController,
  ReconciliationController,
} from './reconciliation/reconciliation.controller';
import { TaxReportsService } from './tax/tax-reports.service';
import { TaxSettlementsService } from './tax/tax-settlements.service';
import {
  EstateTaxSettlementsController,
  TaxReportsController,
  TaxSettlementsController,
} from './tax/tax.controller';
import { PayrollService } from './payroll/payroll.service';
import {
  EstatePayrollController,
  PayrollController,
} from './payroll/payroll.controller';
import {
  AccountingSettingsController,
  BankAccountsController,
  ChartAccountsController,
} from './ledger-config.controller';
import { CollectionsService } from './collections/collections.service';
import {
  CollectionsController,
  EstateCollectionsController,
  ReceiptHistoryController,
  SuspenseController,
} from './collections/collections.controller';
import { OpeningBalancesService } from './opening/opening-balances.service';
import { OpeningBalancesController } from './opening/opening-balances.controller';
import { LateInterestService } from './interest/late-interest.service';
import { LatePaymentInterestPoliciesService } from './interest/late-interest-policies.service';
import {
  LateInterestController,
  LateInterestPoliciesController,
} from './interest/late-interest.controller';
import { YearCloseService } from './closing/year-close.service';
import { YearCloseController } from './closing/year-close.controller';
import { LedgerReportsService } from './reports/ledger-reports.service';
import {
  LedgerReportsController,
  PropertyLedgerController,
} from './reports/ledger-reports.controller';
import { LedgerIntegrityController } from './integrity.controller';
import { ReserveFundPostingService } from './posting/reserve-fund-posting.service';
import { ReserveFundService } from './reserve/reserve-fund.service';
import {
  EstateReserveFundController,
  ReserveFundController,
} from './reserve/reserve-fund.controller';

/**
 * Contabilidad por partida doble (doc/contabilidad/adr-partida-doble.md).
 * Los demás módulos contabilizan a través de `JournalService`, siempre
 * dentro de su propia transacción.
 */
@Module({
  imports: [EstateAccessModule, CryptoModule, FilesModule, FiscalYearsModule],
  controllers: [
    ChartAccountsController,
    BankAccountsController,
    AccountingSettingsController,
    EstateCollectionsController,
    CollectionsController,
    SuspenseController,
    ReceiptHistoryController,
    EstatePayrollController,
    PayrollController,
    TaxReportsController,
    EstateTaxSettlementsController,
    TaxSettlementsController,
    EstateJournalController,
    JournalEntryController,
    BankReconciliationController,
    ReconciliationController,
    EstateBudgetController,
    EstateCostCentreBudgetController,
    OpeningBalancesController,
    LateInterestController,
    LateInterestPoliciesController,
    YearCloseController,
    LedgerReportsController,
    PropertyLedgerController,
    LedgerIntegrityController,
    EstateReserveFundController,
    ReserveFundController,
  ],
  providers: [
    JournalService,
    LedgerQueryService,
    InvariantsService,
    ChartAccountsService,
    BankAccountsService,
    AccountingSettingsService,
    ReceiptPostingService,
    CollectionPostingService,
    CollectionsService,
    SupplierPostingService,
    PayrollPostingService,
    PayrollService,
    TaxSettlementPostingService,
    TaxReportsService,
    TaxSettlementsService,
    TreasuryPostingService,
    JournalBookService,
    ReconciliationService,
    BudgetService,
    OpeningBalancesService,
    LateInterestService,
    LatePaymentInterestPoliciesService,
    YearCloseService,
    LedgerReportsService,
    ReserveFundPostingService,
    ReserveFundService,
  ],
  exports: [
    LedgerReportsService,
    BudgetService,
    JournalBookService,
    TaxReportsService,
    JournalService,
    LedgerQueryService,
    InvariantsService,
    ReceiptPostingService,
    CollectionPostingService,
    SupplierPostingService,
    OpeningBalancesService,
  ],
})
export class LedgerModule {}
