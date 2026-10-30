import { Module } from '@nestjs/common';
import { EstateAccessService } from './estate-access.service';
import { EstateScopeGuard } from './estate-scope.guard';
import { PropertyAccessService } from './property-access.service';

@Module({
  providers: [EstateAccessService, EstateScopeGuard, PropertyAccessService],
  exports: [EstateAccessService, EstateScopeGuard, PropertyAccessService],
})
export class EstateAccessModule {}
