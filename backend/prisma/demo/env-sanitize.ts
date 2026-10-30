import {
  DEMO_FORBIDDEN_KEYS,
  DEMO_FORBIDDEN_TRUE_FLAGS,
} from '../../src/config/env.validation';

/**
 * Descarta del entorno del PROCESO del CLI las claves que `validateEnv`
 * rechaza con DEMO_MODE=true (lista compartida con validateEnv: una sola
 * fuente de verdad). Motivo: `@prisma/client` carga `backend/.env` en
 * `process.env` al importarse, sin pisar lo ya definido, de modo que un .env
 * de desarrollo (VERIFACTU_ENABLED=true, Stripe...) aborta el seed. El seed no
 * llama a ningun servicio externo, asi que descartarlas solo afecta a este
 * proceso. La API demo NO pasa por aqui y sigue validando de forma estricta.
 *
 * Devuelve SOLO los nombres descartados; nunca los valores. Idempotente.
 */
export function discardDemoRejectedEnv(
  env: Record<string, string | undefined>,
): string[] {
  const discarded: string[] = [];
  for (const key of DEMO_FORBIDDEN_KEYS) {
    if ((env[key] ?? '').trim()) {
      delete env[key];
      discarded.push(key);
    }
  }
  for (const key of DEMO_FORBIDDEN_TRUE_FLAGS) {
    if ((env[key] ?? '').trim() === 'true') {
      delete env[key];
      discarded.push(key);
    }
  }
  return discarded;
}

/** Descarta y avisa por stderr con los NOMBRES (nunca valores). */
export function sanitizeDemoCliEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = (m) => console.error(m),
): string[] {
  const discarded = discardDemoRejectedEnv(env);
  if (discarded.length > 0) {
    warn(
      `[seed-demo] AVISO: se descartan del entorno de este proceso las claves de servicios externos incompatibles con DEMO_MODE: ${discarded.join(', ')} (el seed no llama a servicios externos; la API demo sigue validando su entorno).`,
    );
  }
  return discarded;
}
