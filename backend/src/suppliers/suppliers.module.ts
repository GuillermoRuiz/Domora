import { Module } from '@nestjs/common';
import {
  EstateSupplierPaymentsController,
  SupplierPaymentsController,
  SuppliersController,
} from './suppliers.controller';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { LedgerModule } from '../ledger/ledger.module';
import { SuppliersService } from './suppliers.service';
import { SupplierVisitsService } from './supplier-visits.service';
import { SupplierOverviewService } from './supplier-overview.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { IssueWorkflowModule } from '../issue-workflow/issue-workflow.module';

@Module({
  imports: [EstateAccessModule, FilesModule, LedgerModule, IssueWorkflowModule],
  controllers: [SuppliersController, EstateSupplierPaymentsController, SupplierPaymentsController],
  providers: [SuppliersService, SupplierInvoicesService, SupplierVisitsService, SupplierOverviewService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
