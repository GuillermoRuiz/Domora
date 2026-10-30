import { Module } from '@nestjs/common';
import { CryptoModule } from '../sepa/crypto.module';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';
import { SepaCreditorConfig } from './sepa-creditor.config';

@Module({
  imports: [CryptoModule],
  controllers: [AdminBillingController],
  providers: [AdminBillingService, SepaCreditorConfig],
  exports: [AdminBillingService],
})
export class AdminBillingModule {}
