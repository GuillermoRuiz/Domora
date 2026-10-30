import { ScheduleModule } from '@nestjs/schedule';
import { isDemoMode } from './demo-mode';

/**
 * Módulos de planificación para AppModule. Con DEMO_MODE=true no se registra
 * ScheduleModule, de modo que ningún @Cron se ejecuta. Sin DEMO_MODE devuelve
 * exactamente `[ScheduleModule.forRoot()]`, como antes.
 */
export function scheduleModules(
  env: Record<string, unknown> = process.env,
): ReturnType<typeof ScheduleModule.forRoot>[] {
  return isDemoMode(env) ? [] : [ScheduleModule.forRoot()];
}
