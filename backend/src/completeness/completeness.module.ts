import { Module } from '@nestjs/common';
import { EstateSetupService } from '../estates/estate-setup.service';
import { CompletenessController } from './completeness.controller';
import { CompletenessCronService } from './completeness-cron.service';
import { CompletenessService } from './completeness.service';

// EstateSetupService only needs the global PrismaService: provided here rather
// than exported from EstatesModule, which would pull in its whole graph.
@Module({
  controllers: [CompletenessController],
  providers: [CompletenessService, CompletenessCronService, EstateSetupService],
  exports: [CompletenessService],
})
export class CompletenessModule {}
