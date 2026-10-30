/**
 * Arranque LOCAL de preview del backend contra la base embebida (PGlite) que
 * sirve `%TEMP%\domora-ai-live-db\serve.mjs` en el puerto 55433. No es para
 * producción: genera secretos efímeros y desactiva TODOS los cron, salvo el barrido de incidencias
 * (`ISSUE_SWEEP_CRON`) y el worker de IA compartido (`AI_WORKER_CRON`) cuando existe una clave real.
 *
 * Variables opcionales: RAG_API_URL (por defecto http://127.0.0.1:8000),
 * OPENAI_API_KEY, FRONTEND_ORIGINS (separadas por comas).
 *
 * `LOCAL_PREVIEW_AI_WORKER=false` deja el worker apagado aunque exista una clave.
 * Requiere `npm run build` previo.
 *
 * NO arrancar con DEMO_MODE=true: con DEMO_MODE el AppModule no registra
 * ScheduleModule (T0.9) y `app.get(SchedulerRegistry)` de abajo fallaria.
 */
const crypto = require('node:crypto');
const path = require('node:path');

const origins = process.env.FRONTEND_ORIGINS ?? 'http://127.0.0.1:4200,http://localhost:4200,http://127.0.0.1:4317,http://localhost:4317,http://127.0.0.1:4318,http://localhost:4318';
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1&statement_cache_size=0';
process.env.JWT_SECRET ??= crypto.randomBytes(48).toString('base64url');
process.env.SEPA_ENC_KEY ??= crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGIN = origins;
process.env.STORAGE_DIR ??= path.join(process.env.TEMP, 'domora-ai-live-db', 'private-storage');
process.env.VERIFACTU_ENABLED = 'false';
process.env.AI_ENABLED ??= 'true';
const realKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-local-preview-unused';
const aiWorker = process.env.LOCAL_PREVIEW_AI_WORKER !== 'false' && realKey;
process.env.AI_WORKER_ENABLED = aiWorker ? 'true' : 'false';
// Desarrollo: el resultado del modelo ya materializado se purga a las 24 h (en producción no se fija plazo por defecto).
process.env.AI_REQUEST_RESULT_RETENTION_HOURS ??= '24';
// AiConfigService exige una clave si AI_ENABLED=true. Con el worker apagado no se llama
// a OpenAI; esta es solo un relleno para que arranque. La clave del RAG va en rag/.env, no aquí.
process.env.OPENAI_API_KEY ??= 'sk-local-preview-unused';
process.env.OPENAI_MODEL ??= 'gpt-4.1-mini';
process.env.OPENAI_VISION_MODEL ??= 'gpt-4.1-mini';
process.env.RAG_API_URL ??= 'http://127.0.0.1:8000';

const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { SchedulerRegistry } = require('@nestjs/schedule');
const helmet = require('helmet');
const { AppModule } = require('../dist/src/app.module');
const { AI_WORKER_CRON } = require('../dist/src/ai/ai-worker.service');
const { ISSUE_SWEEP_CRON } = require('../dist/src/issue-workflow/issue-workflow-sweep.service');

(async () => {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.enableCors({ origin: origins.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  // Se paran todos los cron salvo el worker de IA (y solo si hay IA con la que trabajar) y el barrido de
  // incidencias (jobs huérfanos y estancadas): ese no depende de la IA y es el que evita que algo quede colgado.
  for (const [name, job] of app.get(SchedulerRegistry).getCronJobs().entries()) {
    const keep = (aiWorker && name === AI_WORKER_CRON) || name === ISSUE_SWEEP_CRON;
    if (!keep) job.stop();
  }
  await app.listen(3000, '127.0.0.1');
  const ai = realKey ? 'OpenAI real' : 'sin IA';
  const smtp = process.env.SMTP_HOST ? process.env.SMTP_HOST + ':' + (process.env.SMTP_PORT ?? 587) : 'sin SMTP (los envíos fallarán y abrirán una tarea de revisión)';
  console.log('LOCAL_PREVIEW_BACKEND_READY http://127.0.0.1:3000/api/v1 (RAG: ' + process.env.RAG_API_URL + ')');
  console.log('  worker de IA: ' + (aiWorker ? 'activo (' + process.env.AI_WORKER_KINDS + ')' : 'apagado') + ' · ' + ai + ' · correo: ' + smtp);
})().catch((e) => { console.error(e.message); process.exit(1); });
