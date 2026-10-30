import { Module } from '@nestjs/common';
import {
  EstateRemesasController,
  PropertyMandatesController,
  RemesasController,
} from './sepa.controller';
import { CryptoModule } from './crypto.module';
import { SepaPain008Service } from './sepa-pain008.service';
import { MandatesService } from './mandates.service';
import { RemesasService } from './remesas.service';
import { ReturnFilesService } from './return-files.service';
import {
  EstateReturnFilesController,
  ReturnFilesController,
} from './return-files.controller';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [EstateAccessModule, CryptoModule, LedgerModule],
  controllers: [
    PropertyMandatesController,
    EstateRemesasController,
    RemesasController,
    EstateReturnFilesController,
    ReturnFilesController,
  ],
  providers: [
    SepaPain008Service,
    MandatesService,
    RemesasService,
    ReturnFilesService,
  ],
  exports: [CryptoModule, SepaPain008Service, MandatesService, RemesasService],
})
export class SepaModule {}
