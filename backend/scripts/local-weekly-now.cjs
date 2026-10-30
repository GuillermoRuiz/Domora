/**
 * SOLO DESARROLLO LOCAL. Genera ahora mismo (llamada síncrona a OpenAI vía `OpenAiService.run`, sin Batch)
 * la revisión semanal de Domora Intelligence de una finca y la guarda como
 * completada en la base local. En producción esto lo hace el cron semanal con Batch.
 *
 * Uso (desde backend/, tras `npm run build`):
 *   OPENAI_API_KEY=... node scripts/local-weekly-now.cjs <estateId>
 */
const { PrismaClient } = require('../dist/src/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const { AiConfigService } = require('../dist/src/ai/ai-config.service');
const { AiOutputService } = require('../dist/src/ai/ai-output.service');
const { OpenAiService } = require('../dist/src/ai/openai.service');
const { WeeklyAiService } = require('../dist/src/ai/weekly-ai.service');
const { madridWeekKey } = require('../dist/src/ai/weekly-clock');
const { weeklyIntelligence } = require('../dist/src/ai/use-cases');

const estateId = process.argv[2];
if (!estateId || !process.env.OPENAI_API_KEY) {
  console.error('Uso: OPENAI_API_KEY=... node scripts/local-weekly-now.cjs <estateId>');
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55433/postgres';
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

(async () => {
  try {
    const config = new AiConfigService(new ConfigService({ AI_ENABLED: 'true', OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', OPENAI_API_KEY: process.env.OPENAI_API_KEY }));
    const ai = new OpenAiService(config, new AiOutputService());
    const weekly = new WeeklyAiService(p, null, config);
    const now = new Date();
    const weekKey = madridWeekKey(now);
    const calculated = await weekly.snapshot(estateId, now);
    // Llamada síncrona (sin Batch) por la única puerta de IA: caso de uso + datos de origen.
    const result = await ai.run(weeklyIntelligence, calculated.facts, { estateId });
    const seen = new Set();
    for (const item of result.value.items) {
      const s = calculated.signals.find((x) => x.id === item.signal_id);
      if (!s || s.entity_type !== item.entity_type || s.entity_id !== item.entity_id || seen.has(s.id)) throw new Error('AI_WEEKLY_ENTITY_INVALID');
      seen.add(s.id);
    }
    const data = { snapshot: calculated.facts, signals: calculated.signals, status: 'completed', intelligence: result.value, completedAt: new Date() };
    await p.aiWeeklySnapshot.upsert({
      where: { estateId_weekKey: { estateId, weekKey } },
      create: { estateId, weekKey, snapshotAt: now, ...data },
      update: { snapshotAt: now, ...data },
    });
    console.log('WEEKLY_OK items=' + result.value.items.length);
    console.log(result.value.summary);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
