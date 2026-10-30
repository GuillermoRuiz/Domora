/**
 * SOLO DESARROLLO. Ejecuta AHORA el barrido de incidencias que normalmente corre cada 10 minutos
 * (`IssueWorkflowSweepService`): da por fallidos los jobs que nadie atendió (no hay worker) y abre
 * «sin siguiente paso» en las incidencias estancadas.
 *
 *   node scripts/dev-sweep-now.cjs
 *
 * Usa la misma base que local-preview (DATABASE_URL, por defecto la PGlite del puerto 55433). Los márgenes
 * salen de ISSUE_JOB_ORPHAN_AFTER_MINUTES (30) e ISSUE_STALLED_GRACE_MINUTES (240); se pueden bajar para probar.
 * Requiere `npm run build` previo.
 */
const crypto = require('node:crypto');
const path = require('node:path');

if (process.env.NODE_ENV === 'production') {
  console.error('Este script es solo para desarrollo.');
  process.exit(1);
}
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1&statement_cache_size=0';
process.env.JWT_SECRET ??= crypto.randomBytes(48).toString('base64url');
process.env.SEPA_ENC_KEY ??= crypto.randomBytes(32).toString('hex');
process.env.STORAGE_DIR ??= path.join(
  process.env.TEMP ?? require('node:os').tmpdir(),
  'domora-ai-live-db',
  'private-storage',
);
process.env.VERIFACTU_ENABLED = 'false';
// El worker no arranca aquí: solo se ejecuta el barrido.
process.env.AI_WORKER_ENABLED = 'false';
process.env.ISSUE_SWEEP_ENABLED = 'false';

(async () => {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module');
  const {
    IssueWorkflowSweepService,
  } = require('../dist/src/issue-workflow/issue-workflow-sweep.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const result = await app.get(IssueWorkflowSweepService).sweep();
    console.log('SWEEP_RESULT ' + JSON.stringify(result));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
