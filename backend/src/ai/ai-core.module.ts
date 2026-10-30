import { Module } from '@nestjs/common';
import { AiQueueService } from './ai-queue.service';
import { AiConfigService } from './ai-config.service';
import { AiOutputService } from './ai-output.service';
import { OpenAiService } from './openai.service';
import { AiWorkerHeartbeatService } from './ai-worker-heartbeat.service';
@Module({
  providers: [
    AiQueueService,
    AiConfigService,
    AiOutputService,
    OpenAiService,
    AiWorkerHeartbeatService,
  ],
  exports: [
    AiQueueService,
    AiConfigService,
    AiOutputService,
    OpenAiService,
    AiWorkerHeartbeatService,
  ],
})
export class AiCoreModule {}
