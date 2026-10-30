import { Module } from '@nestjs/common';
import { FiscalYearsController } from './fiscal-years.controller';
import { FiscalYearsService } from './fiscal-years.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';

@Module({
  imports: [EstateAccessModule],
  controllers: [FiscalYearsController],
  providers: [FiscalYearsService],
  exports: [FiscalYearsService],
})
export class FiscalYearsModule {}
