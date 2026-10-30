import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/sepa/crypto.service';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

/**
 * Cifra los IBAN que hayan quedado en claro en las columnas que deberían
 * estar cifradas (`estates.creditor_iban` y `mandates.debtor_iban`).
 *
 * Existe porque `CryptoService.decrypt()` acepta valores sin el prefijo
 * `enc:v1:` para tolerar datos anteriores al cifrado. Esa tolerancia era
 * necesaria para migrar, pero sin fecha de caducidad se vuelve permanente: un
 * IBAN escrito en claro por un error de código nunca se detecta, porque el
 * sistema lo lee tan feliz. Este script cierra esa puerta; `decrypt()` ahora
 * además lo registra como ERROR cuando se topa con uno.
 *
 * Uso (las variables de entorno deben estar disponibles en el proceso):
 *   npx ts-node scripts/encrypt-plaintext-ibans.ts --dry-run
 *   npx ts-node scripts/encrypt-plaintext-ibans.ts
 *
 * Es idempotente: los valores ya cifrados se ignoran, así que puede
 * ejecutarse las veces que haga falta.
 */

const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * El script corre fuera del contenedor de Nest, así que no hay inyección de
 * dependencias. En lugar de duplicar por tercera vez el algoritmo de cifrado
 * (ya pasó con seed.ts), se reutiliza el CryptoService real con un objeto que
 * cumple la parte de ConfigService que necesita.
 */
function buildCryptoService(): CryptoService {
  const configLike = {
    get: (key: string): string | undefined => process.env[key],
    getOrThrow: (key: string): string => {
      const value = process.env[key];
      if (value === undefined) {
        throw new Error(`Falta la variable de entorno ${key}.`);
      }
      return value;
    },
  } as unknown as ConfigService;
  return new CryptoService(configLike);
}

function isPlaintext(value: string | null): value is string {
  return value !== null && value.length > 0 && !value.startsWith(ENCRYPTED_PREFIX);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createPrismaClient();
  const crypto = buildCryptoService();

  try {
    const [estates, mandates] = await Promise.all([
      prisma.estate.findMany({ select: { id: true, name: true, creditorIban: true } }),
      prisma.mandate.findMany({ select: { id: true, debtorIban: true } }),
    ]);

    const estatesToFix = estates.filter((e) => isPlaintext(e.creditorIban));
    const mandatesToFix = mandates.filter((m) => isPlaintext(m.debtorIban));

    console.log(
      `Fincas: ${estates.length} revisadas, ${estatesToFix.length} con IBAN en claro.`,
    );
    console.log(
      `Mandatos: ${mandates.length} revisados, ${mandatesToFix.length} con IBAN en claro.`,
    );

    if (estatesToFix.length === 0 && mandatesToFix.length === 0) {
      console.log('Nada que hacer: no queda ningún IBAN sin cifrar.');
      return;
    }

    if (dryRun) {
      for (const estate of estatesToFix) {
        console.log(`  [dry-run] finca ${estate.name} (${estate.id})`);
      }
      for (const mandate of mandatesToFix) {
        console.log(`  [dry-run] mandato ${mandate.id}`);
      }
      console.log('Simulación: no se ha modificado nada.');
      return;
    }

    for (const estate of estatesToFix) {
      await prisma.estate.update({
        where: { id: estate.id },
        data: { creditorIban: crypto.encrypt(estate.creditorIban as string) },
      });
      console.log(`  cifrado IBAN de la finca ${estate.name} (${estate.id})`);
    }
    for (const mandate of mandatesToFix) {
      await prisma.mandate.update({
        where: { id: mandate.id },
        data: { debtorIban: crypto.encrypt(mandate.debtorIban) },
      });
      console.log(`  cifrado IBAN del mandato ${mandate.id}`);
    }

    console.log(
      `Listo: ${estatesToFix.length + mandatesToFix.length} IBAN cifrados.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('El script falló:', error);
  process.exitCode = 1;
});
