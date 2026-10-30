import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { SubscriptionGraceCronService } from './subscription-grace-cron.service';
import { AdminsModule } from '../admins/admins.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AdminsModule, NotificationsModule],
  controllers: [BillingController],
  providers: [BillingService, StripeService, SubscriptionGraceCronService],
})
export class BillingModule {}
