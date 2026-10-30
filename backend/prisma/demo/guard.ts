import {
  type DbTarget,
  isDemoDbName,
  isDemoMode,
  parseDbTarget,
} from '../../src/config/demo-mode';

/** Marcador escrito por el seed al terminar (COMMENT ON DATABASE). */
export const DEMO_DB_MARKER = 'domora:demo-seed-v1';
export const DEMO_EMAIL_DOMAIN = '@demo.domora.app';

export class DemoGuardError extends Error {
  constructor(message: string) {
    super(`[demo-guard] ${message}`);
    this.name = 'DemoGuardError';
  }
}

/** Lo que la capa 4 necesita saber de la BD (inyectable en tests). */
export interface DbProbe {
  /** Hay filas en users o administrators. */
  hasData: boolean;
  /** COMMENT ON DATABASE actual (shobj_description) o null. */
  comment: string | null;
  /** Existe algún user *@demo.domora.app. */
  hasDemoUser: boolean;
}

/** Ejecuta SQL de solo lectura y devuelve las filas. Inyectable. */
export type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

export function readDbTarget(env: NodeJS.ProcessEnv): DbTarget {
  const target = parseDbTarget(env['DATABASE_URL'] ?? '');
  if (!target) {
    throw new DemoGuardError(
      'DATABASE_URL ausente o ininterpretable: no se puede identificar la BD.',
    );
  }
  return target;
}

/**
 * Capas 1-3 (sin tocar la BD): DEMO_MODE, nombre de BD y host.
 * Lanza DemoGuardError ante cualquier incumplimiento.
 */
export function assertDemoEnv(env: NodeJS.ProcessEnv, db: DbTarget): void {
  // Capa 1
  if (!isDemoMode(env)) {
    throw new DemoGuardError(
      'DEMO_MODE no es "true": el seed demo no se ejecuta.',
    );
  }
  // Capa 2
  if (!isDemoDbName(db.name)) {
    throw new DemoGuardError(
      `La BD "${db.name}" no es una BD demo (debe contener "demo" como token y no ser "domora").`,
    );
  }
  // Capa 3
  if (/prod/i.test(db.host)) {
    throw new DemoGuardError(
      `El host "${db.host}" parece de producción: se aborta.`,
    );
  }
  const allowed = (env['DEMO_ALLOWED_DB_HOSTS'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(db.host)) {
    throw new DemoGuardError(
      `El host "${db.host}" no está en DEMO_ALLOWED_DB_HOSTS.`,
    );
  }
}

/**
 * Capa 4 (pura): la BD está vacía, o lleva el marcador demo, o contiene un
 * usuario demo. Una BD con datos que no cumpla ninguna se rechaza.
 */
export function assertDbLooksDemo(probe: DbProbe): void {
  const ok =
    !probe.hasData || probe.comment === DEMO_DB_MARKER || probe.hasDemoUser;
  if (!ok) {
    throw new DemoGuardError(
      'La BD tiene datos y no es una BD demo (sin marcador ni usuarios @demo.domora.app).',
    );
  }
}

/** Las 4 capas con la BD ya sondeada (síncrono, usado por los tests). */
export function assertDemoSafe(
  env: NodeJS.ProcessEnv,
  db: DbTarget,
  probe: DbProbe,
): void {
  assertDemoEnv(env, db);
  assertDbLooksDemo(probe);
}

function truthy(v: unknown): boolean {
  return v === true || v === 't' || v === 'true' || v === 1;
}

/** Sondeo real, solo lectura. Solo se llama tras pasar las capas 1-3. */
export async function probeDatabase(query: QueryFn): Promise<DbProbe> {
  const data = await query(
    `SELECT (EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM administrators)) AS has_data,
            EXISTS (SELECT 1 FROM users WHERE email ILIKE '%${DEMO_EMAIL_DOMAIN}') AS has_demo_user`,
  );
  const comment = await query(
    `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()`,
  );
  return {
    hasData: truthy(data[0]?.['has_data']),
    hasDemoUser: truthy(data[0]?.['has_demo_user']),
    comment: (comment[0]?.['comment'] as string | null | undefined) ?? null,
  };
}

/**
 * Ejecuta `action` (p. ej. el wipe) SOLO si las 4 capas pasan. Las capas 1-3
 * se evalúan antes de abrir ninguna consulta contra la BD. Si el guard falla,
 * `action` NO se invoca.
 */
export async function runGuarded<T>(
  env: NodeJS.ProcessEnv,
  query: QueryFn,
  action: () => Promise<T>,
): Promise<T> {
  const db = readDbTarget(env);
  assertDemoEnv(env, db);
  assertDbLooksDemo(await probeDatabase(query));
  return action();
}
