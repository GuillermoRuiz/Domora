import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { PrismaClient } from '../../src/prisma/client';
import { DEMO_DB_NAME_PATTERN } from '../../src/config/demo-mode';

/** Tablas que el wipe NUNCA vacía. */
export const WIPE_EXCLUDED_TABLES: readonly string[] = ['_prisma_migrations'];

export interface WipeResult {
  /** Tablas truncadas (schema public menos las excluidas). */
  truncatedTables: number;
  /** Filas globales de inspection_types (estate_id IS NULL) reinsertadas. */
  restoredInspectionTypes: number;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Vacía TODA la BD demo en UNA transacción (design D4, corregido por T0.1):
 *  1. `set_config('domora.journal_purge','on',true)` (GUC local a la tx) para
 *     que los triggers BEFORE TRUNCATE del diario/recibos/facturas dejen pasar.
 *  2. Guarda el catálogo global de `inspection_types` (estate_id IS NULL) en
 *     una tabla temporal ON COMMIT DROP (el TRUNCATE ... CASCADE de estates
 *     lo arrastraría por la FK).
 *  3. TRUNCATE dinámico de todas las tablas de `pg_tables` (public) salvo
 *     `_prisma_migrations`.
 *  4. Reinserta el catálogo guardado.
 *
 * Sin `session_replication_role` (requiere superuser) ni
 * `accounting_purge_estate`. NO comprueba el guard: el llamador debe invocarlo
 * a través de `runGuarded` (ver seed-demo.ts).
 */
export async function wipeDatabase(prisma: PrismaClient): Promise<WipeResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('domora.journal_purge', 'on', true)`;
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE _keep ON COMMIT DROP AS SELECT * FROM inspection_types WHERE estate_id IS NULL`,
      );
      const tables = await tx.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename`;
      const names = tables
        .map((t) => t.tablename)
        .filter((n) => !WIPE_EXCLUDED_TABLES.includes(n));
      if (names.length > 0) {
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${names.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`,
        );
      }
      const restored = await tx.$executeRawUnsafe(
        `INSERT INTO inspection_types SELECT * FROM _keep`,
      );
      return {
        truncatedTables: names.length,
        restoredInspectionTypes: restored,
      };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

export class StorageDirError extends Error {
  constructor(message: string) {
    super(`[demo-storage] ${message}`);
    this.name = 'StorageDirError';
  }
}

/**
 * Valida (sin borrar nada) que STORAGE_DIR es seguro de vaciar. Devuelve la
 * ruta absoluta, o null si no hay STORAGE_DIR configurado (no se toca nada).
 * Reglas: ruta con un token "demo" delimitado en algún segmento, o
 * directorio inexistente/vacío; nunca la raíz, el cwd ni un ancestro suyo.
 */
export async function resolveStorageDirToClear(
  rawDir: string | undefined,
  cwd: string = process.cwd(),
): Promise<string | null> {
  const trimmed = rawDir?.trim();
  if (!trimmed) return null;
  const dir = path.resolve(trimmed);
  const parsed = path.parse(dir);
  const segments = dir
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  if (segments.length < 2) {
    throw new StorageDirError(
      `STORAGE_DIR "${dir}" es demasiado cercano a la raíz: no se vacía.`,
    );
  }
  const resolvedCwd = path.resolve(cwd);
  const rel = path.relative(dir, resolvedCwd);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new StorageDirError(
      `STORAGE_DIR "${dir}" es el directorio de trabajo o un ancestro: no se vacía.`,
    );
  }
  const looksDemo = segments.some((s) => DEMO_DB_NAME_PATTERN.test(s));
  if (looksDemo) return dir;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return dir; // no existe: nada que vaciar
  }
  if (entries.length === 0) return dir;
  throw new StorageDirError(
    `STORAGE_DIR "${dir}" no contiene "demo" en su ruta y no está vacío: no se vacía.`,
  );
}

/** Vacía el CONTENIDO de `dir` (ya validado), sin borrar el directorio. */
export async function clearStorageDir(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  }
  return entries.length;
}
