import { Module } from '@nestjs/common';
import { CompletenessModule } from '../completeness/completeness.module';
import { ClientStatusService } from './client-status.service';

@Module({
  imports: [CompletenessModule],
  providers: [ClientStatusService],
  exports: [ClientStatusService],
})
export class ClientStatusModule {}
