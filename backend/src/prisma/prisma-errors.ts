import { Prisma } from './client';

/**
 * Prisma 7 talks to Postgres through a driver adapter. Errors Prisma does not
 * map itself (exclusion, check, custom SQLSTATE raised by triggers) and the
 * details of the ones it does map (violated constraint) travel under
 * `meta.driverAdapterError.cause` instead of the engine's `meta.target` and
 * message text. These helpers read both shapes so callers do not care.
 */
interface AdapterCause {
  originalCode?: string;
  originalMessage?: string;
  code?: string;
  message?: string;
  detail?: string;
  constraint?: { index?: string; fields?: string[] };
}

function adapterCause(error: unknown): AdapterCause | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError))
    return undefined;
  const meta = error.meta as
    { driverAdapterError?: { cause?: AdapterCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

/** SQLSTATE reported by Postgres, when the driver adapter exposes it. */
export function pgErrorCode(error: unknown): string | undefined {
  const cause = adapterCause(error);
  return cause?.originalCode ?? cause?.code;
}

/** Message and detail written by Postgres itself (e.g. a trigger's RAISE). */
export function pgErrorMessage(error: unknown): string | undefined {
  const cause = adapterCause(error);
  return cause?.originalMessage ?? cause?.message;
}

/**
 * Full searchable text of a database error: the Prisma message plus what
 * Postgres reported (constraint name, detail). Use it to match a constraint
 * name regardless of how the error was delivered.
 */
export function dbErrorText(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const cause = adapterCause(error);
  return [
    error.message,
    cause?.originalMessage,
    cause?.detail,
    cause?.constraint?.index,
  ]
    .filter(Boolean)
    .join(' ');
}

/** True for a unique violation (P2002) on the given column or constraint. */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.['target'];
  if (Array.isArray(target) && target.includes(column)) return true;
  if (typeof target === 'string' && target.includes(column)) return true;
  const constraint = adapterCause(error)?.constraint;
  return (
    !!constraint?.fields?.includes(column) ||
    !!constraint?.index?.includes(column)
  );
}
