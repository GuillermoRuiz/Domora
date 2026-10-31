import { Module } from '@nestjs/common';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ManagerKpisService } from './manager-kpis.service';
import { ManagerActivityService } from './manager-activity.service';
import { ManagerEconomicService } from './manager-economic.service';
import { ManagerMilestonesService } from './manager-milestones.service';
import { ManagerPerformanceService } from './manager-performance.service';
import { ManagerPendingService } from './manager-pending.service';
import { ManagerOverviewController } from './manager-overview.controller';

@Module({
  imports: [EstateAccessModule, LedgerModule],
  controllers: [ManagerOverviewController],
  providers: [
    ManagerKpisService,
    ManagerPendingService,
    ManagerMilestonesService,
    ManagerEconomicService,
    ManagerActivityService,
    ManagerPerformanceService,
  ],
})
export class ManagerOverviewModule {}
