import { Module } from '@nestjs/common';
import { MeetingVoteDelegationsController } from './meeting-vote-delegations.controller';
import { MeetingVoteDelegationsService } from './meeting-vote-delegations.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [EstateAccessModule, FilesModule],
  controllers: [MeetingVoteDelegationsController],
  providers: [MeetingVoteDelegationsService],
  exports: [MeetingVoteDelegationsService],
})
export class MeetingVoteDelegationsModule {}
