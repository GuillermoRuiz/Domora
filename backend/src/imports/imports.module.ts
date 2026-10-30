import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [EstateAccessModule, FilesModule, LedgerModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
