import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '../../src/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createBaseContext, type DemoCtx } from './context';
import { sanitizeDemoCliEnv } from './env-sanitize';
import { DEMO_DB_MARKER, type QueryFn, runGuarded } from './guard';
import { runF0Bootstrap } from './phases/f0-bootstrap';
import { runF1People } from './phases/f1-people';
import { runF2Accounting } from './phases/f2-accounting';
import { runF2Installations } from './phases/f2-installations';
import { runF2SupplierPanel } from './phases/f2-supplier-panel';
import { runF3OwnerPanel } from './phases/f3-owner-panel';
import { runF4Portfolio } from './phases/f4-portfolio';
import { runF5Contracts } from './phases/f5-contracts';
import { runF6GeneralData } from './phases/f6-general-data';
import {
  clearStorageDir,
  resolveStorageDirToClear,
  wipeDatabase,
  type WipeResult,
} from './wipe';
import { createPrismaClient } from '../../src/prisma/create-prisma-client';

/**
 * Entrypoint del seed demo (T0.12). TODO pasa por `runGuarded` (4 capas del
 * guard): el wipe y el seed solo se ejecutan tras superarlas.
 *
 * Flujo: guard -> (--reset: validar STORAGE_DIR, wipe en tx, vaciar
 * STORAGE_DIR) -> contexto Nest con DemoSeedModule -> fases -> marcador
 * `COMMENT ON DATABASE`. Sin `--reset` sobre una BD con datos aborta.
 */
export class SeedDemoError extends Error {
  constructor(message: string) {
    super(`[seed-demo] ${message}`);
    this.name = 'SeedDemoError';
  }
}

export interface SeedDemoArgs {
  reset: boolean;
  /**
   * `--hard` (T0.10, design D4-b): ANTES del wipe normal, recrea el schema
   * con `prisma migrate reset`. Implica `--reset`. Solo para reset local
   * "nuclear" (p. ej. tras cambiar migraciones); NO lo usa el cron nocturno.
   */
  hard: boolean;
}

export function parseArgs(argv: readonly string[]): SeedDemoArgs {
  const hard = argv.includes('--hard');
  return { reset: hard || argv.includes('--reset'), hard };
}

export interface SeedDemoSummary {
  reset: boolean;
  hard: boolean;
  wipe: WipeResult | null;
  storageEntriesRemoved: number | null;
}

/** Dependencias efectivas del seed; inyectables en tests. */
export interface SeedDemoDeps {
  /** Solo lectura: sondeo del guard y comprobación de BD vacía. */
  query: QueryFn;
  wipe: () => Promise<WipeResult>;
  /**
   * Solo `--hard`: recrea el schema ejecutando las migraciones desde cero.
   * Se invoca UNICAMENTE dentro de `runGuarded` (BD ya identificada como demo).
   */
  migrateReset?: () => Promise<void>;
  /** Contexto Nest + fases. */
  seed: () => Promise<void>;
  /** COMMENT ON DATABASE <actual> IS 'domora:demo-seed-v1'. */
  markDatabase: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/** Deps reales. El PrismaClient se crea perezoso: el guard falla antes. */
export function createDefaultDeps(env: NodeJS.ProcessEnv): SeedDemoDeps {
  let client: PrismaClient | null = null;
  const prisma = (): PrismaClient => {
    const url = env['DATABASE_URL'];
    if (!url) throw new SeedDemoError('DATABASE_URL ausente.');
    client ??= createPrismaClient(url);
    return client;
  };
  return {
    query: (sql) =>
      prisma().$queryRawUnsafe<Array<Record<string, unknown>>>(sql),
    wipe: () => wipeDatabase(prisma()),
    migrateReset: () => Promise.resolve(runMigrateReset(env)),
    seed: () => runPhases(env),
    markDatabase: async () => {
      await prisma().$executeRawUnsafe(
        `DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), '${DEMO_DB_MARKER}'); END $$`,
      );
    },
    disconnect: async () => {
      await client?.$disconnect();
    },
  };
}

/**
 * `prisma migrate reset --force` contra la DATABASE_URL YA validada por el
 * guard. Desde Prisma 7 el reset no ejecuta el seed ni genera el cliente por su
 * cuenta (ya no existen --skip-seed / --skip-generate), asi que el seed minimo
 * de CI (admin@domora.app) no corre en la BD demo.
 */
export function runMigrateReset(env: NodeJS.ProcessEnv): void {
  const res = spawnSync(
    'npx',
    ['prisma', 'migrate', 'reset', '--force'],
    {
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  if (res.status !== 0) {
    throw new SeedDemoError(
      `prisma migrate reset falló (código ${String(res.status)}).`,
    );
  }
}

/**
 * Logger del seed: solo error/warn y SIN los avisos de MailService ("SMTP no
 * configurado, email NO enviado"), que en el entorno demo son esperados (cero
 * llamadas externas) y, por cada invitación, volcarían el enlace completo.
 */
class SeedLogger extends ConsoleLogger {
  constructor() {
    super({ logLevels: ['error', 'warn'] });
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    if (rest[rest.length - 1] === 'MailService') return;
    super.warn(message, ...rest);
  }
}

async function runPhases(env: NodeJS.ProcessEnv): Promise<void> {
  // PrismaService (Nest) resuelve DATABASE_URL del proceso: debe ser LA MISMA
  // BD que validó el guard, no otra.
  if (env['DATABASE_URL'] !== process.env['DATABASE_URL']) {
    throw new SeedDemoError(
      'DATABASE_URL del entorno validado difiere de process.env: se aborta.',
    );
  }
  // @prisma/client ya cargo backend/.env al importarse (arriba). Se descartan
  // las claves externas que validateEnv rechaza ANTES de cargar
  // DemoSeedModule: su ConfigModule.forRoot({ validate }) se evalua al hacer
  // require, por eso el require es tardio (un import estatico lo ejecutaria
  // antes del guard y antes de este descarte).
  sanitizeDemoCliEnv(process.env);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DemoSeedModule } = require('./demo-seed.module') as {
    DemoSeedModule: typeof import('./demo-seed.module').DemoSeedModule;
  };
  const app = await NestFactory.createApplicationContext(DemoSeedModule, {
    logger: new SeedLogger(),
  });
  try {
    const prisma = app.get(PrismaService);
    const base = createBaseContext(env);
    const actors = await runF0Bootstrap(app, prisma, base.rng);
    const ctx: DemoCtx = {
      ...base,
      app,
      prisma,
      actors,
      estates: [],
      named: {},
    };
    await runF1People(ctx);
    await runF2Accounting(ctx);
    await runF2Installations(ctx);
    await runF2SupplierPanel(ctx);
    await runF3OwnerPanel(ctx);
    await runF4Portfolio(ctx);
    await runF5Contracts(ctx);
    await runF6GeneralData(ctx);
  } finally {
    await app.close();
  }
}

export async function runSeedDemo(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
  deps: SeedDemoDeps = createDefaultDeps(env),
): Promise<SeedDemoSummary> {
  const args = parseArgs(argv);
  try {
    return await runGuarded(env, deps.query, async () => {
      const summary: SeedDemoSummary = {
        reset: args.reset,
        hard: args.hard,
        wipe: null,
        storageEntriesRemoved: null,
      };
      if (args.reset) {
        // Validar STORAGE_DIR ANTES de borrar nada en BD.
        const storageDir = await resolveStorageDirToClear(env['STORAGE_DIR']);
        if (args.hard) {
          if (!deps.migrateReset) {
            throw new SeedDemoError(
              '--hard no disponible: falta migrateReset.',
            );
          }
          await deps.migrateReset();
        }
        summary.wipe = await deps.wipe();
        if (storageDir) {
          summary.storageEntriesRemoved = await clearStorageDir(storageDir);
        }
      } else {
        const rows = await deps.query(
          `SELECT (EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM administrators)) AS has_data`,
        );
        const v = rows[0]?.['has_data'];
        if (v === true || v === 't' || v === 'true') {
          throw new SeedDemoError(
            'La BD demo ya tiene datos: usa --reset para vaciarla y reconstruirla.',
          );
        }
      }
      await deps.seed();
      await deps.markDatabase();
      return summary;
    });
  } finally {
    await deps.disconnect();
  }
}

if (require.main === module) {
  runSeedDemo(process.env, process.argv.slice(2))
    .then((s) => {
      console.log(
        `[seed-demo] OK (reset=${s.reset}, hard=${s.hard},tablas truncadas=${s.wipe?.truncatedTables ?? '-'}, catálogo inspection_types reinsertado=${s.wipe?.restoredInspectionTypes ?? '-'}).`,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(1);
    });
}
