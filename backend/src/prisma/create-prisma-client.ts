import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './client';

/**
 * Driver adapter shared by every Prisma client in the backend. Prisma 7
 * no longer connects on its own: the client needs an adapter.
 */
export function createPgAdapter(url?: string): PrismaPg {
  return new PrismaPg({ connectionString: url ?? process.env['DATABASE_URL'] });
}

/**
 * Single place where a PrismaClient is built outside Nest (specs, seeds and
 * scripts). Centralizing it lets us change how it connects (adapter, pool,
 * URL) by touching one file. `options.transactionOptions` overrides the
 * interactive transaction defaults (for example a longer `maxWait`).
 */
export function createPrismaClient(
  url?: string,
  options: Pick<Prisma.PrismaClientOptions, 'transactionOptions'> = {},
): PrismaClient {
  return new PrismaClient({ ...options, adapter: createPgAdapter(url) });
}
