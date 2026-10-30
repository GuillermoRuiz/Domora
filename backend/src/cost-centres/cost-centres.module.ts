import { Module } from '@nestjs/common';
import { CostCentresController } from './cost-centres.controller';
import { CostCentresService } from './cost-centres.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';

@Module({
  imports: [EstateAccessModule],
  controllers: [CostCentresController],
  providers: [CostCentresService],
  exports: [CostCentresService],
})
export class CostCentresModule {}
