import { PrismaClient } from '../src/prisma/client';
import type { ConfigService } from '@nestjs/config';
import { CatastroFacadeService } from '../src/catastro/catastro-facade.service';
import { backfillFacades } from '../src/catastro/catastro-facade-backfill';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

/**
 * Rellena la caché de fachadas del Catastro para todas las fincas que tienen
 * referencia catastral pero aún no tienen foto resuelta.
 *
 * El script corre fuera del contenedor de Nest (igual que
 * `encrypt-plaintext-ibans.ts`): usa PrismaClient directamente e instancia
 * CatastroFacadeService con un shim mínimo de ConfigService.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-catastro-facades.ts
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-catastro-facades.ts --limit=50
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-catastro-facades.ts --retry
 *
 * Variables de entorno requeridas: DATABASE_URL
 * Variables opcionales:   CATASTRO_ENABLED (si es "false" el script no hace nada)
 */

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : 200;

const configShim = {
  get: (key: string): string | undefined => process.env[key],
} as unknown as ConfigService;

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  // CatastroFacadeService toma PrismaService (extends PrismaClient) — PrismaClient
  // satisface la interfaz que usa internamente (estate.updateMany).
  const facade = new CatastroFacadeService(configShim, prisma as any);

  try {
    const result = await backfillFacades(prisma as any, facade, {
      limit,
      retry: process.argv.includes('--retry'),
      log: console.log,
      pause: () => new Promise((resolve) => setTimeout(resolve, 250)),
    });
    console.log(result);
    if (result.errors) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error((error as Error).message ?? error);
  process.exitCode = 1;
});
