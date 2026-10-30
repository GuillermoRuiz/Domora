import {
  ConflictException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../../prisma/client';
import { pgErrorCode, pgErrorMessage } from '../../prisma/prisma-errors';

/**
 * Traduce los errores de las garantías del diario (SQLSTATE de clase DM,
 * migración ledger_core) a excepciones HTTP con el mensaje en español que
 * escribió la propia base de datos.
 *
 * Los triggers diferidos saltan al confirmar la transacción y Prisma los
 * entrega como errores genéricos, sin SQLSTATE: por eso esos mensajes
 * llevan el código delante y aquí se busca también en el texto.
 */
const CONFLICT_CODES = new Set(['DM015', 'DM016', 'DM020', 'DM022', 'DM042']);

export interface LedgerDbError {
  code: string;
  message: string;
}

/**
 * El texto de un error de Prisma puede incluir un fragmento del código que
 * hizo la llamada (y ese código puede mencionar otros códigos DM), así que
 * NO vale el primer "DMxxx" que aparezca. Por orden de fiabilidad:
 * 1. `meta.code` (errores conocidos);
 * 2. el SQLSTATE del error de Postgres: `code: "DMxxx"`;
 * 3. el prefijo de los triggers diferidos: `ERROR: DMxxx: …`.
 */
export function parseLedgerDbError(error: unknown): LedgerDbError | null {
  if (!(error instanceof Error)) return null;
  const meta = (error as Prisma.PrismaClientKnownRequestError).meta as
    { code?: string; message?: string } | undefined;
  // Prisma 7 + driver adapter: known errors carry the SQLSTATE under
  // meta.driverAdapterError; deferred triggers (raised on COMMIT) arrive as a
  // bare DriverAdapterError whose message starts with the code ("DM002: …").
  const adapterCode = pgErrorCode(error);
  const code = meta?.code?.startsWith('DM')
    ? meta.code
    : adapterCode?.startsWith('DM')
      ? adapterCode
      : (/code: "(DM\d{3})"/.exec(error.message)?.[1] ??
        /ERROR: (DM\d{3}):/.exec(error.message)?.[1] ??
        /^(DM\d{3}):/.exec(error.message)?.[1]);
  if (!code) return null;

  const fromMeta =
    meta?.message ??
    (adapterCode?.startsWith('DM') ? pgErrorMessage(error) : undefined);
  const fromText =
    /message: "([^"]+)"/.exec(error.message)?.[1] ??
    /ERROR: ([^\n]+)/.exec(error.message)?.[1] ??
    (/^DM\d{3}:/.test(error.message) ? error.message : undefined);
  // Los triggers diferidos llevan el código al principio del texto
  // ("DM002: …", migración ledger_deferred_error_codes): se quita.
  const message = (
    fromMeta ??
    fromText ??
    'La operación contable no es válida.'
  )
    .replace(/^DM\d{3}:\s*/, '')
    .trim();
  return { code, message };
}

export function toLedgerHttpException(error: unknown): HttpException | null {
  const parsed = parseLedgerDbError(error);
  if (!parsed) return null;
  return CONFLICT_CODES.has(parsed.code)
    ? new ConflictException(parsed.message)
    : new UnprocessableEntityException(parsed.message);
}

type TxFn<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/**
 * Ejecuta una operación contable en una transacción y traduce los errores
 * de las garantías. Tiempos holgados: la numeración espera turno con un
 * bloqueo de fila y los cierres de ejercicio mueven muchas líneas.
 */
export async function runPosting<T>(
  prisma: PrismaClient,
  fn: TxFn<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await prisma.$transaction(fn, {
      maxWait: 15_000,
      timeout: opts.timeoutMs ?? 30_000,
    });
  } catch (error) {
    throw toLedgerHttpException(error) ?? error;
  }
}
