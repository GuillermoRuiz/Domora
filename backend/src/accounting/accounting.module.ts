import { Module } from '@nestjs/common';
import {
  EstateAccountingController,
  EstateReceiptsController,
  ReceiptsController,
  UserReceiptsController,
} from './accounting.controller';
import { AccountingService } from './accounting.service';
import { ReceiptReminderCronService } from './receipt-reminder-cron.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EstateAccessModule, FilesModule, LedgerModule, NotificationsModule],
  controllers: [
    EstateAccountingController,
    EstateReceiptsController,
    ReceiptsController,
    UserReceiptsController,
  ],
  providers: [AccountingService, ReceiptReminderCronService],
  exports: [AccountingService],
})
export class AccountingModule {}
