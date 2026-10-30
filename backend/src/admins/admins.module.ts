import { Module } from '@nestjs/common';
import {
  AdminsController,
  PlansController,
  SubscriptionsController,
} from './admins.controller';
import { AdminsService } from './admins.service';
import { VerifactuModule } from '../verifactu/verifactu.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { ClientStatusModule } from '../client-status/client-status.module';

@Module({
  imports: [VerifactuModule, InvoicingModule, ClientStatusModule],
  controllers: [AdminsController, SubscriptionsController, PlansController],
  providers: [AdminsService],
  exports: [AdminsService],
})
export class AdminsModule {}
