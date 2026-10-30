import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CompletenessService } from './completeness.service';

/**
 * Logs «Onboarding completado» for the despachos that finished their setup
 * since the previous night (S11). Completitud is derived on read, so there is
 * no write to hook into: a nightly pass is the only place to notice it.
 */
@Injectable()
export class CompletenessCronService {
  private readonly logger = new Logger(CompletenessCronService.name);

  constructor(private readonly completeness: CompletenessService) {}

  @Cron('0 15 23 * * *')
  async run(): Promise<void> {
    try {
      await this.completeness.recordOnboardingCompletions();
    } catch (error) {
      this.logger.error('Error registrando los onboardings completados', error);
    }
  }
}
