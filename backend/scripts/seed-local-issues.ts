/**
 * Rellena con incidencias de ejemplo (historial, proveedor, presupuesto,
 * notificaciones y fotos) una BD LOCAL que ya tiene fincas, p. ej. la base
 * PGlite del preview (`scripts/local-preview.cjs`). No es el seed demo: ese
 * exige una BD demo vacía; este solo AÑADE incidencias a lo que haya.
 *
 *   npx ts-node --transpile-only scripts/seed-local-issues.ts
 *
 * Idempotente: las referencias son `#INC-LOC-<finca>-<n>`; las que ya existen se saltan.
 * Variables: LOCAL_DATABASE_URL (por defecto, la del preview) y LOCAL_STORAGE_DIR
 * (por defecto, el del preview: donde el backend lee las fotos). No se usan
 * DATABASE_URL ni STORAGE_DIR a propósito: Prisma carga backend/.env, que apunta
 * a otra BD, y así no se escribe en ella por accidente.
 */
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { StorageService } from '../src/files/storage.service';
import { PORTFOLIO, type PortfolioIssue } from '../prisma/demo/data/portfolio';
import { createSeededIssue } from '../prisma/demo/lib/issue-seed';

const DATABASE_URL =
  process.env['LOCAL_DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1&statement_cache_size=0';
const STORAGE_DIR = process.env['LOCAL_STORAGE_DIR'] ?? path.join(process.env['TEMP'] ?? '.', 'domora-ai-live-db', 'private-storage');

/** Misma lógica que el seed demo, pero relativa a hoy. */
const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

/** Proveedores de ejemplo por categoría: solo la copia congelada de la asignación, sin crear `suppliers`. */
const PROVIDER_PHONES: Record<string, string> = {
  Ascensores: '912 345 678',
  Seguridad: '913 456 789',
  Calefacción: '914 567 890',
  'Protección contra incendios': '915 678 901',
  Piscinas: '916 789 012',
  Limpieza: '917 890 123',
  Electricidad: '918 901 234',
  Jardinería: '919 012 345',
};

async function main(): Promise<void> {
  const prisma = createPrismaClient(DATABASE_URL);
  const storage = new StorageService({ get: (key: string) => (key === 'STORAGE_DIR' ? STORAGE_DIR : undefined) } as unknown as ConfigService);
  try {
    const gestora = await prisma.user.findFirst({ where: { role: 'B' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!gestora) throw new Error('No hay ningún usuario gestor (rol B) en la BD.');
    const estates = await prisma.estate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

    const pool: PortfolioIssue[] = PORTFOLIO.flatMap((e) => e.issues);
    let created = 0;
    for (const [k, estate] of estates.entries()) {
      const properties = await prisma.property.findMany({
        where: { estateId: estate.id, deletedAt: null },
        orderBy: { ref: 'asc' },
        select: { id: true, primaryUserId: true },
      });
      if (properties.length === 0) continue;
      const count = Math.max(3, Math.min(8, Math.ceil(properties.length / 3)));
      const ownerIds = properties.map((p) => p.primaryUserId).filter((id): id is string => id !== null);
      const owners = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, fullName: true } });
      const ownerById = new Map(owners.map((o) => [o.id, o]));

      for (let j = 0; j < count; j++) {
        const ref = `#INC-LOC-${k + 1}-${String(j + 1).padStart(2, '0')}`;
        if (await prisma.issue.findUnique({ where: { ref }, select: { id: true } })) continue;
        // Cada finca arranca en un punto distinto del catálogo para que no repitan las mismas incidencias.
        const spec = pool[(k * 7 + j) % pool.length] as PortfolioIssue;
        const property = properties[(j * 5 + k) % properties.length]!;
        await createSeededIssue(prisma, storage, {
          ref,
          estateId: estate.id,
          spec,
          gestoraId: gestora.id,
          owner: property.primaryUserId ? ownerById.get(property.primaryUserId) : undefined,
          supplier: spec.supplierCategory
            ? { name: `${spec.supplierCategory} Local S.L.`, category: spec.supplierCategory, phone: PROVIDER_PHONES[spec.supplierCategory] ?? null }
            : undefined,
          recipients: properties.length,
          estateName: estate.name,
          day,
          photoSeed: k * 10 + j,
        });
        created++;
      }
      console.log(`${estate.name}: ${count} incidencias (propiedades: ${properties.length})`);
    }
    console.log(`Incidencias creadas: ${created}. Fotos en ${STORAGE_DIR}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
