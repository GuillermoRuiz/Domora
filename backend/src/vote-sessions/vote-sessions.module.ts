import { Module } from '@nestjs/common';
import { VoteSessionsController } from './vote-sessions.controller';
import { VoteSessionsService } from './vote-sessions.service';
import { VoteTallyService } from './vote-tally.service';
import { VoteDebtService } from './vote-debt.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [EstateAccessModule, MeetingsModule, TwoFactorModule, MailModule],
  controllers: [VoteSessionsController],
  providers: [VoteSessionsService, VoteTallyService, VoteDebtService],
  exports: [VoteSessionsService, VoteTallyService],
})
export class VoteSessionsModule {}
