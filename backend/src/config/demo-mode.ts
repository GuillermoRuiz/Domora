/**
 * Utilidades del modo demo (DEMO_MODE=true). Todo es ADITIVO: sin DEMO_MODE
 * ninguna de estas funciones cambia el comportamiento de la aplicación.
 *
 * Compartido por `validateEnv` (arranque de la API) y por el guard del seed
 * demo (`prisma/demo/guard.ts`) para que ambos usen exactamente la misma
 * definición de "esto es una BD demo".
 */

/** El nombre de la BD debe contener el token `demo` delimitado por -, _ o extremos. */
export const DEMO_DB_NAME_PATTERN = /(^|[-_])demo($|[-_])/i;

export function isDemoMode(
  env: Record<string, unknown> = process.env,
): boolean {
  const value = env['DEMO_MODE'];
  return typeof value === 'string' && value.trim() === 'true';
}

export interface DbTarget {
  name: string;
  host: string;
}

/**
 * Extrae nombre de BD y host de una DATABASE_URL. Devuelve null si no se
 * puede interpretar (el llamador debe tratarlo como NO seguro).
 */
export function parseDbTarget(databaseUrl: string): DbTarget | null {
  try {
    const url = new URL(databaseUrl);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!name) return null;
    return { name, host: url.hostname };
  } catch {
    return null;
  }
}

export function isDemoDbName(name: string): boolean {
  return name.toLowerCase() !== 'domora' && DEMO_DB_NAME_PATTERN.test(name);
}
