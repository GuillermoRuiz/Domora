import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { ClientHealthModule } from '../client-health/client-health.module';
import { UsageModule } from '../usage/usage.module';
import { ClientsController, LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ClientsService } from './clients.service';

/** Clientes (odd/tasks/role-a-panel.md S13): leads, conversion and the commercial view of the despachos. */
@Module({
  imports: [AdminsModule, ClientHealthModule, UsageModule],
  controllers: [LeadsController, ClientsController],
  providers: [LeadsService, ClientsService],
})
export class LeadsModule {}
