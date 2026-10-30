/**
 * Reloj del seed demo: UNA ancla `now` capturada una sola vez. Todo el
 * dataset se expresa como offsets relativos a ella. No parchea `Date` global
 * (los servicios que usan `new Date()` internamente se corrigen luego con
 * backdate RAW, ver design D3).
 */
const DAY_MS = 86_400_000;

export interface Clock {
  /** Ancla inmutable. */
  readonly anchor: Date;
  /** Fecha = ancla + offsetDays (negativo = pasado). */
  d(offsetDays: number): Date;
  /** Primer día (00:00 UTC) del mes situado `n` meses antes del de la ancla. */
  monthStart(n: number): Date;
  /** Misma fecha que la ancla `n` meses antes (día recortado al fin de mes). */
  monthsAgo(n: number): Date;
}

/** Medianoche UTC del instante dado. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Resuelve el ancla: `DEMO_NOW` (ISO) si está definido, si no hoy UTC 00:00.
 * `realNow` es inyectable para tests.
 */
export function resolveAnchor(
  env: NodeJS.ProcessEnv = process.env,
  realNow: Date = new Date(),
): Date {
  const raw = env['DEMO_NOW']?.trim();
  if (!raw) return startOfUtcDay(realNow);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`DEMO_NOW inválido (se espera ISO 8601): "${raw}"`);
  }
  return startOfUtcDay(parsed);
}

export function createClock(anchor: Date): Clock {
  const fixed = new Date(anchor.getTime());
  const frozen = (): Date => new Date(fixed.getTime());
  return {
    get anchor() {
      return frozen();
    },
    d: (offsetDays) => new Date(fixed.getTime() + offsetDays * DAY_MS),
    monthStart: (n) =>
      new Date(Date.UTC(fixed.getUTCFullYear(), fixed.getUTCMonth() - n, 1)),
    monthsAgo: (n) => {
      const y = fixed.getUTCFullYear();
      const m = fixed.getUTCMonth() - n;
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(fixed.getUTCDate(), lastDay)));
    },
  };
}

/** Ancla del proceso, capturada UNA vez al importar el módulo. */
export const ANCHOR: Date = resolveAnchor();
