import { Module } from '@nestjs/common';
import { DespachoResolverService } from './despacho-resolver.service';
import { StaffAuditService } from './staff-audit.service';
import { SupportSessionsService } from './support-sessions.service';
import { SupportAccessGuard } from './support-access.guard';
import { StaffAuditController, SupportSessionsController } from './support-access.controller';

/**
 * Role A access model (odd/tasks/role-a-panel.md S5). The guard itself is
 * registered as APP_GUARD in AppModule, right after RolesGuard, so the guard
 * order stays visible in one place.
 */
@Module({
  controllers: [SupportSessionsController, StaffAuditController],
  providers: [DespachoResolverService, StaffAuditService, SupportSessionsService, SupportAccessGuard],
  exports: [DespachoResolverService, StaffAuditService, SupportSessionsService, SupportAccessGuard],
})
export class SupportAccessModule {}
