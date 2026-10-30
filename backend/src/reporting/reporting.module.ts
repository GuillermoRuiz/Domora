import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { EstatesModule } from '../estates/estates.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { ReportScopeService } from './report-scope.service';
import { ReportAuditService } from './report-audit.service';
import { ReportSnapshotService } from './report-snapshot.service';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { FinancialReportsService } from './handlers/financial-reports.service';
import { PortfolioReportsService } from './handlers/portfolio-reports.service';
import { ReceiptReportsService } from './handlers/receipt-reports.service';
import { OperationsReportsService } from './handlers/operations-reports.service';
import { CompositeReportsService } from './handlers/composite-reports.service';

@Module({
  imports: [LedgerModule, EstatesModule, MeetingsModule],
  controllers: [ReportingController],
  providers: [
    ReportScopeService,
    ReportAuditService,
    ReportSnapshotService,
    ReportingService,
    FinancialReportsService,
    PortfolioReportsService,
    ReceiptReportsService,
    OperationsReportsService,
    CompositeReportsService,
  ],
  exports: [ReportingService, ReportScopeService],
})
export class ReportingModule {}
