import { Module } from '@nestjs/common';
import { EstateGovernanceController } from './estate-governance.controller';
import { EstateGovernanceService } from './estate-governance.service';
import { EstateGeneralController } from './estate-general.controller';
import { EstateGeneralService } from './estate-general.service';
import { EstatesController } from './estates.controller';
import { EstatesService } from './estates.service';
import { EstateSetupService } from './estate-setup.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { SepaModule } from '../sepa/sepa.module';
import { CatastroModule } from '../catastro/catastro.module';
import { FilesModule } from '../files/files.module';
import { EstateOverviewService } from './estate-overview.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { EstateOverviewExcelService } from './estate-overview-excel.service';
import { EstateCommunityService } from './estate-community.service';

@Module({
  imports: [EstateAccessModule, SepaModule, CatastroModule, FilesModule],
  controllers: [
    EstatesController,
    EstateGovernanceController,
    EstateGeneralController,
  ],
  providers: [
    EstateGovernanceService,
    EstateGeneralService,
    EstatesService,
    EstateSetupService,
    EstateOverviewService,
    EstateOverviewExcelService,
    EstateCommunityService,
    LedgerQueryService,
  ],
  exports: [EstatesService, EstateOverviewService],
})
export class EstatesModule {}
