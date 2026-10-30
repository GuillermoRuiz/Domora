import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EstateDashboardController } from './estate-dashboard.controller';
import { EstateDashboardService } from './estate-dashboard.service';

@Module({
  imports: [AccountingModule, EstateAccessModule, LedgerModule],
  controllers: [EstateDashboardController],
  providers: [EstateDashboardService],
})
export class EstateDashboardModule {}
